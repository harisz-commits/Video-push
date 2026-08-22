import { describe, expect, it, vi } from 'vitest';
import { LocalPlatformService } from '@/platform/LocalPlatformService';
import { YouTubePlatformService } from '@/platform/YouTubePlatformService';
import { createPlatformService, isPlayablesEnvironment } from '@/platform/detectPlatform';
import type { YtGame } from '@/platform/ytgame';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    _map: map,
  };
}

/** A cooperative fake SDK; individual tests break the parts they care about. */
function fakeSdk(overrides: Partial<YtGame> = {}): YtGame {
  return {
    IN_PLAYABLES_ENV: true,
    system: {
      getLanguage: () => 'de-DE',
      isAudioEnabled: () => true,
      onAudioEnabledChange: () => () => {},
      onPause: () => () => {},
      onResume: () => () => {},
    },
    game: {
      firstFrameReady: vi.fn(),
      gameReady: vi.fn(),
      loadData: async () => '',
      saveData: async () => {},
    },
    engagement: { sendScore: async () => {} },
    ads: { requestInterstitialAd: async () => {}, requestRewardedAd: async () => {} },
    health: { logError: vi.fn(), logWarning: vi.fn() },
    ...overrides,
  };
}

describe('detectPlatform', () => {
  it('selects the YouTube adapter only inside a Playables environment', async () => {
    const scope = { ytgame: fakeSdk() };
    expect(isPlayablesEnvironment(scope)).toBe(true);
    expect((await createPlatformService(scope)).kind).toBe('youtube');
  });

  it('falls back to local when the SDK is absent', async () => {
    expect(isPlayablesEnvironment({})).toBe(false);
    expect((await createPlatformService({})).kind).toBe('local');
  });

  it('falls back to local when the SDK loaded but is not a Playables host', async () => {
    const scope = { ytgame: { IN_PLAYABLES_ENV: false } };
    expect((await createPlatformService(scope)).kind).toBe('local');
  });

  it('falls back to local for a malformed ytgame global', async () => {
    for (const value of [null, 'yes', 42, undefined]) {
      expect((await createPlatformService({ ytgame: value })).kind).toBe('local');
    }
  });
});

describe('save gate', () => {
  it('refuses to save before loadGame() has completed (§24)', async () => {
    const storage = memoryStorage();
    const platform = new LocalPlatformService({ storage });

    expect(await platform.saveGame('{"early":true}')).toBe(false);
    expect(storage._map.size).toBe(0);

    await platform.loadGame();
    expect(await platform.saveGame('{"ok":true}')).toBe(true);
    expect(storage._map.size).toBe(1);
  });

  it('unseals saving even when the load itself failed', async () => {
    const sdk = fakeSdk({
      game: {
        firstFrameReady: vi.fn(),
        gameReady: vi.fn(),
        loadData: async () => {
          throw new Error('host offline');
        },
        saveData: async () => {},
      },
    });
    const platform = new YouTubePlatformService(sdk);

    expect(await platform.loadGame()).toBeNull();
    expect(await platform.saveGame('{"a":1}')).toBe(true);
  });

  it('reports a failed save instead of throwing', async () => {
    const sdk = fakeSdk({
      game: {
        firstFrameReady: vi.fn(),
        gameReady: vi.fn(),
        loadData: async () => '',
        saveData: async () => {
          throw new Error('quota');
        },
      },
    });
    const platform = new YouTubePlatformService(sdk);
    await platform.loadGame();
    expect(await platform.saveGame('{"a":1}')).toBe(false);
  });

  it('round-trips a payload through local storage', async () => {
    const storage = memoryStorage();
    const first = new LocalPlatformService({ storage });
    await first.loadGame();
    await first.saveGame('{"coins":42}');

    const second = new LocalPlatformService({ storage });
    expect(await second.loadGame()).toBe('{"coins":42}');
  });

  it('treats an empty host payload as "no save"', async () => {
    const platform = new YouTubePlatformService(fakeSdk());
    expect(await platform.loadGame()).toBeNull();
  });
});

describe('lifecycle signals', () => {
  it('sends firstFrameReady and gameReady at most once (§33/§34)', () => {
    const sdk = fakeSdk();
    const platform = new YouTubePlatformService(sdk);

    platform.firstFrameReady();
    platform.firstFrameReady();
    platform.gameReady();
    platform.gameReady();
    platform.gameReady();

    expect(sdk.game?.firstFrameReady).toHaveBeenCalledTimes(1);
    expect(sdk.game?.gameReady).toHaveBeenCalledTimes(1);
  });

  it('survives an SDK whose lifecycle calls throw', () => {
    const sdk = fakeSdk({
      game: {
        firstFrameReady: () => {
          throw new Error('boom');
        },
        gameReady: () => {
          throw new Error('boom');
        },
        loadData: async () => '',
        saveData: async () => {},
      },
    });
    const platform = new YouTubePlatformService(sdk);
    expect(() => {
      platform.firstFrameReady();
      platform.gameReady();
    }).not.toThrow();
  });
});

describe('host subscriptions', () => {
  it('relays pause, resume and audio changes, and honours unsubscribe', async () => {
    // Held in an object: TypeScript's control-flow analysis would otherwise
    // narrow these to `never` at the call sites below.
    const host: {
      audio?: (enabled: boolean) => void;
      pause?: () => void;
      resume?: () => void;
    } = {};

    const sdk = fakeSdk({
      system: {
        getLanguage: () => 'en',
        isAudioEnabled: () => true,
        onAudioEnabledChange: (cb) => {
          host.audio = cb;
          return () => {};
        },
        onPause: (cb) => {
          host.pause = cb;
          return () => {};
        },
        onResume: (cb) => {
          host.resume = cb;
          return () => {};
        },
      },
    });

    const platform = new YouTubePlatformService(sdk);
    await platform.initialize();

    const audio = vi.fn();
    const pause = vi.fn();
    const resume = vi.fn();
    const offAudio = platform.subscribeAudioChange(audio);
    platform.subscribePause(pause);
    platform.subscribeResume(resume);

    host.audio?.(false);
    host.pause?.();
    host.resume?.();

    expect(audio).toHaveBeenCalledWith(false);
    expect(platform.isAudioEnabled()).toBe(false);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);

    offAudio();
    host.audio?.(true);
    expect(audio).toHaveBeenCalledTimes(1);
    // Cached state still tracks the host even with no listeners left.
    expect(platform.isAudioEnabled()).toBe(true);
  });

  it('defaults audio to enabled when the host cannot answer', async () => {
    const platform = new YouTubePlatformService(
      fakeSdk({
        system: {
          getLanguage: () => {
            throw new Error('nope');
          },
          isAudioEnabled: () => {
            throw new Error('nope');
          },
          onAudioEnabledChange: () => () => {},
          onPause: () => () => {},
          onResume: () => () => {},
        },
      }),
    );
    await platform.initialize();
    expect(platform.isAudioEnabled()).toBe(true);
    expect(platform.getLanguage()).toBe('en');
  });
});

describe('ads', () => {
  it('reports rewarded=false when the ad does not complete', async () => {
    const platform = new YouTubePlatformService(
      fakeSdk({
        ads: {
          requestInterstitialAd: async () => {
            throw new Error('no fill');
          },
          requestRewardedAd: async () => {
            throw new Error('dismissed');
          },
        },
      }),
    );
    await expect(platform.showRewardedAd('free-shuffle')).resolves.toEqual({
      rewarded: false,
      reason: 'dismissed',
    });
    await expect(platform.showInterstitial()).resolves.toEqual({
      shown: false,
      reason: 'unavailable',
    });
  });

  it('reports not-ready rather than throwing when the ads API is missing', async () => {
    const sdk = fakeSdk();
    delete sdk.ads;
    const platform = new YouTubePlatformService(sdk);
    expect((await platform.showRewardedAd('board-rescue')).rewarded).toBe(false);
    expect((await platform.showInterstitial()).shown).toBe(false);
  });

  it('never rewards from a failing mock ad in local mode', async () => {
    const platform = new LocalPlatformService({ adSuccessRate: 0 });
    expect((await platform.showRewardedAd('generator-boost')).rewarded).toBe(false);
    expect((await platform.showInterstitial()).shown).toBe(false);
  });
});

describe('score', () => {
  it('sends integers only and swallows host rejection', async () => {
    const sendScore = vi.fn(async () => {});
    const platform = new YouTubePlatformService(
      fakeSdk({ engagement: { sendScore } }),
    );

    await platform.sendScore(1234.87);
    expect(sendScore).toHaveBeenCalledWith({ value: 1234 });

    await platform.sendScore(-5);
    expect(sendScore).toHaveBeenLastCalledWith({ value: 0 });

    const failing = new YouTubePlatformService(
      fakeSdk({
        engagement: {
          sendScore: async () => {
            throw new Error('rate limited');
          },
        },
      }),
    );
    await expect(failing.sendScore(10)).resolves.toBeUndefined();
  });
});

describe('local adapter without storage', () => {
  it('degrades to a no-op instead of crashing', async () => {
    const platform = new LocalPlatformService({ storage: null });
    expect(await platform.loadGame()).toBeNull();
    expect(await platform.saveGame('{"a":1}')).toBe(true);
  });
});

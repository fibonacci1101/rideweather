import { describe, expect, it } from 'vitest';
import { pickJapanesePlaceName, resolveDisplayPlaceName, toJaPrefecture } from './reverseGeocode';

describe('toJaPrefecture', () => {
  it('英名の都道府県を日本語化する', () => {
    expect(toJaPrefecture('Mie')).toBe('三重県');
    expect(toJaPrefecture('Tokyo')).toBe('東京都');
    expect(toJaPrefecture('Osaka')).toBe('大阪府');
    expect(toJaPrefecture('Kyoto')).toBe('京都府');
    expect(toJaPrefecture('Hokkaido')).toBe('北海道');
  });

  it('" Prefecture"付き・マクロン付きでも拾える', () => {
    expect(toJaPrefecture('Kyoto Prefecture')).toBe('京都府');
    expect(toJaPrefecture('Hyōgo')).toBe('兵庫県');
    expect(toJaPrefecture('Ōita')).toBe('大分県');
  });

  it('既に日本語ならそのまま返す', () => {
    expect(toJaPrefecture('三重県')).toBe('三重県');
  });

  it('未知・未定義はundefined', () => {
    expect(toJaPrefecture('Bavaria')).toBeUndefined();
    expect(toJaPrefecture(undefined)).toBeUndefined();
    expect(toJaPrefecture('')).toBeUndefined();
  });
});

describe('pickJapanesePlaceName', () => {
  it('local_names.jaを最優先で使う', () => {
    const results = [
      { name: 'Matsusaka', local_names: { ja: '松阪市', en: 'Matsusaka' }, state: 'Mie', country: 'JP' },
    ];
    expect(pickJapanesePlaceName(results)).toBe('松阪市');
  });

  it('local_names.jaが無ければ、後続の結果からでも日本語名を拾う', () => {
    const results = [
      { name: 'Kamiyamada', state: 'Mie', country: 'JP' },
      { name: 'Ise', local_names: { ja: '伊勢市' }, state: 'Mie', country: 'JP' },
    ];
    expect(pickJapanesePlaceName(results)).toBe('伊勢市');
  });

  it('nameが日本語ならそれを使う', () => {
    expect(pickJapanesePlaceName([{ name: '津市', state: 'Mie' }])).toBe('津市');
  });

  it('ローマ字の市名しか無ければ都道府県名の日本語化にフォールバックする', () => {
    const results = [{ name: 'Kamiyamada', state: 'Mie', country: 'JP' }];
    expect(pickJapanesePlaceName(results)).toBe('三重県');
  });

  it('日本語名も既知の都道府県も無ければundefined(ローマ字は返さない)', () => {
    expect(pickJapanesePlaceName([{ name: 'Springfield', state: 'Illinois', country: 'US' }])).toBeUndefined();
    expect(pickJapanesePlaceName([])).toBeUndefined();
    expect(pickJapanesePlaceName(undefined)).toBeUndefined();
  });

  it('配列にnull等が混ざってもクラッシュしない(OWMレスポンス防御)', () => {
    const results = [null, { name: 'x' }, { local_names: { ja: '桑名市' } }] as unknown as Parameters<
      typeof pickJapanesePlaceName
    >[0];
    expect(pickJapanesePlaceName(results)).toBe('桑名市');
  });
});

describe('resolveDisplayPlaceName', () => {
  it('日本語名が取れればそれを使う', () => {
    expect(
      resolveDisplayPlaceName(
        [{ name: 'Matsusaka', local_names: { ja: '松阪市' }, state: 'Mie', country: 'JP' }],
        { name: 'Matsusaka', country: 'JP' }
      )
    ).toBe('松阪市');
  });

  it('国内で日本語名が取れなければ、ローマ字のcity.nameではなくundefinedを返す', () => {
    expect(
      resolveDisplayPlaceName([{ name: 'Kamiyamada', country: 'JP' }], { name: 'Kamiyamada', country: 'JP' })
    ).toBeUndefined();
  });

  it('国外は逆ジオコーディングが弱くてもcity.nameをそのまま使う', () => {
    expect(
      resolveDisplayPlaceName(undefined, { name: 'Munich', country: 'DE' })
    ).toBe('Munich');
  });

  it('国が不明(city.country欠損)なら日本語名が無くてもcity.nameを使う(国外の地名まで消さない・F-08)', () => {
    expect(resolveDisplayPlaceName(undefined, { name: 'Somewhere' })).toBe('Somewhere');
  });

  it('JPと確定していてローマ字しか無い場合だけundefinedにする', () => {
    expect(resolveDisplayPlaceName([{ name: 'Kamiyamada' }], { name: 'Kamiyamada', country: 'JP' })).toBeUndefined();
    // city自体が無い場合もundefined
    expect(resolveDisplayPlaceName(undefined, undefined)).toBeUndefined();
  });
});

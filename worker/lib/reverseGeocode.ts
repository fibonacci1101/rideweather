// OWMのforecastが返す city.name は日本の地方部だとローマ字("Kamiyamada")や
// 都道府県止まり("Mie")になりがちで、地名表示として使い物にならない(実走行で発覚)。
// OWM Geocoding reverse API(local_names付き)を主経路にし、できるだけ日本語の地名を選ぶ。
// ローマ字は出さない方針(粗くても日本語 > 正確なローマ字)。

export type OwmGeoResult = {
  name?: string;
  local_names?: Record<string, string>;
  state?: string;
  country?: string;
};

// OWMのstateは日本の場合「Prefecture」を除いた英名で返る(例: "Mie", "Osaka", "Tokyo", "Hokkaido")。
// マクロン付き("Hyōgo"等)や " Prefecture" 付きでも拾えるよう、参照側で正規化してから引く
const JP_PREFECTURE_JA: Record<string, string> = {
  Hokkaido: '北海道',
  Aomori: '青森県', Iwate: '岩手県', Miyagi: '宮城県',
  Akita: '秋田県', Yamagata: '山形県', Fukushima: '福島県',
  Ibaraki: '茨城県', Tochigi: '栃木県', Gunma: '群馬県',
  Saitama: '埼玉県', Chiba: '千葉県', Tokyo: '東京都', Kanagawa: '神奈川県',
  Niigata: '新潟県', Toyama: '富山県', Ishikawa: '石川県', Fukui: '福井県',
  Yamanashi: '山梨県', Nagano: '長野県',
  Gifu: '岐阜県', Shizuoka: '静岡県', Aichi: '愛知県', Mie: '三重県',
  Shiga: '滋賀県', Kyoto: '京都府', Osaka: '大阪府', Hyogo: '兵庫県',
  Nara: '奈良県', Wakayama: '和歌山県',
  Tottori: '鳥取県', Shimane: '島根県', Okayama: '岡山県',
  Hiroshima: '広島県', Yamaguchi: '山口県',
  Tokushima: '徳島県', Kagawa: '香川県', Ehime: '愛媛県', Kochi: '高知県',
  Fukuoka: '福岡県', Saga: '佐賀県', Nagasaki: '長崎県', Kumamoto: '熊本県',
  Oita: '大分県', Miyazaki: '宮崎県', Kagoshima: '鹿児島県',
  Okinawa: '沖縄県',
};

// 日本語(かな・漢字)を含むか。Unicodeプロパティエスケープでソース上の生の文字に依存させない
const HAS_JA_CHARS = /[\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Han}]/u;
// NFD分解で生じる結合マーク(マクロン等)を除去するための範囲
const COMBINING_MARKS = /\p{Mn}/gu;

export function toJaPrefecture(state: string | undefined): string | undefined {
  if (!state) return undefined;
  const trimmed = state.trim();
  if (HAS_JA_CHARS.test(trimmed)) return trimmed; // 既に日本語
  // "Kyoto Prefecture" -> "Kyoto"、"Hyōgo" -> "Hyogo"(マクロン除去)
  const key = trimmed
    .replace(/\s*Prefecture$/i, '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .trim();
  return JP_PREFECTURE_JA[key];
}

/**
 * OWM Geocoding reverse APIの結果配列(limit>1で複数返りうる)から、表示に使う地名を1つ選ぶ。
 * 優先順: local_names.ja > 日本語のname > 都道府県名の日本語化。いずれも取れなければundefined
 * (ローマ字しか無い場合は表示しない)。
 */
export function pickJapanesePlaceName(results: OwmGeoResult[] | undefined): string | undefined {
  if (!results || results.length === 0) return undefined;
  // OWMが配列にnull等を混ぜても落ちないよう、参照はすべてオプショナルチェーンで受ける
  for (const r of results) {
    const ja = r?.local_names?.ja?.trim();
    if (ja) return ja;
  }
  for (const r of results) {
    const n = r?.name?.trim();
    if (n && HAS_JA_CHARS.test(n)) return n;
  }
  for (const r of results) {
    const pref = toJaPrefecture(r?.state);
    if (pref) return pref;
  }
  return undefined;
}

/**
 * 天気レスポンスに添える最終的な地名を決める。
 * - 日本語名が取れればそれを使う。
 * - 取れないとき、国が「JPと確定している」場合のみローマ字のcity.nameを捨てて「無し」にする(ユーザー方針)。
 * - それ以外(国外、または city.country が欠損)は city.name をそのまま使う。
 *   国が不明なだけで地名を全消しすると、city.country を返さないケースで国外の地名まで消える(レビューF-08)。
 *   国内でローマ字が出るのは city.country 欠損時に限られ、頻度が低いため副作用として許容する。
 */
export function resolveDisplayPlaceName(
  geoResults: OwmGeoResult[] | undefined,
  city: { name?: string; country?: string } | undefined
): string | undefined {
  const ja = pickJapanesePlaceName(geoResults);
  if (ja) return ja;
  if (city?.country === 'JP') return undefined;
  return city?.name || undefined;
}

import type { TrackPoint } from './types';

// これ以上大きいファイルは同期パース(DOMParser)がメインスレッドを長時間ブロックしうるため、
// 読み込み前に弾く。実ファイルでの負荷計測後に調整すること(plans/STEP2_IMPLEMENTATION_PLAN.md 2.2参照)
export const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024;

type RawPoint = { lat: number; lon: number; ele?: number; distanceMeters?: number };

const EARTH_RADIUS_METERS = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

function isValidLatLon(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

// Haversine積算で累積距離(d)を算出する(GPX全般、およびTCXでDistanceMetersが使えない場合の共通経路)
function buildTrackPointsWithHaversine(rawPoints: RawPoint[]): TrackPoint[] {
  let cumulative = 0;
  const result: TrackPoint[] = [];
  for (let i = 0; i < rawPoints.length; i++) {
    const p = rawPoints[i];
    if (i > 0) {
      const prev = rawPoints[i - 1];
      cumulative += haversineMeters(prev.lat, prev.lon, p.lat, p.lon);
    }
    result.push({ x: p.lon, y: p.lat, d: cumulative, e: p.ele });
  }
  return result;
}

// getElementsByTagNameNSが返すライブHTMLCollectionは、実装によってはArray.from()での
// 変換自体がO(n^2)になりうる(実測: 400kmブルベ・27,241点のTCXで約60秒かかり、直接の子要素
// 走査に置き換えても改善しなかったため、真因はTrackpoint検索(ドキュメント全体走査)側と判明)。
// そのため子孫探索・直接の子探索とも、children(こちらは非ライブ)を使った手動走査で統一する
function directChildByLocalName(parent: Element, localName: string): Element | null {
  for (const child of parent.children) {
    if (child.localName === localName) return child;
  }
  return null;
}

function directChildrenByLocalName(parent: Element, localName: string): Element[] {
  const result: Element[] = [];
  for (const child of parent.children) {
    if (child.localName === localName) result.push(child);
  }
  return result;
}

// ドキュメント内の任意の深さから該当ローカル名の要素を文書順に再帰的に集める(手動DFS)。
// Trackpoint要素はActivities/Activity/Lap/Track/... や Courses/Course/Lap/Track/... など
// 経路が一定しないため、直接の子探索だけでは辿り着けない。木の深さ自体は浅い
// (Trackpointの祖先は5〜6階層程度)ため、点数が多くても再帰の深さは問題にならない
function descendantsByLocalName(root: Element, localName: string, out: Element[] = []): Element[] {
  for (const child of root.children) {
    if (child.localName === localName) out.push(child);
    descendantsByLocalName(child, localName, out);
  }
  return out;
}

// 要素が存在しない、または中身が空文字列の場合はundefined(欠損)を返す。
// 空文字列を素通しすると Number('') === 0 になり、「標高0m」のように欠損値が
// 有効な数値として誤受理されてしまう(コードレビューで発見、GPX/TCXの標高・
// TCXの緯度経度・DistanceMetersすべてに影響する共通の原因だった)
function parseNumberContent(el: Element | null): number | undefined {
  const text = el?.textContent?.trim();
  if (!text) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

// 属性が存在しない、または空文字列の場合はNaNを返す(呼び出し側のisValidLatLonで除外させる)。
// 属性欠落時、素の Number(el.getAttribute(...)) は Number(null) === 0 になり、
// 「緯度経度0度(ギニア湾)」として誤って有効な座標扱いされてしまう(コードレビューで発見)
function parseAttributeNumber(el: Element, attrName: string): number {
  const raw = el.getAttribute(attrName);
  if (raw === null || raw.trim() === '') return NaN;
  return Number(raw);
}

function pushGpxTrkpt(el: Element, out: RawPoint[]): void {
  const lat = parseAttributeNumber(el, 'lat');
  const lon = parseAttributeNumber(el, 'lon');
  if (!isValidLatLon(lat, lon)) return;
  const ele = parseNumberContent(directChildByLocalName(el, 'ele'));
  out.push({ lat, lon, ele });
}

function parseGpx(doc: Document): TrackPoint[] {
  const rawPoints: RawPoint[] = [];
  const trkElements = directChildrenByLocalName(doc.documentElement, 'trk');

  if (trkElements.length > 0) {
    for (const trk of trkElements) {
      const trksegs = directChildrenByLocalName(trk, 'trkseg');
      for (const trkseg of trksegs) {
        for (const trkpt of directChildrenByLocalName(trkseg, 'trkpt')) {
          pushGpxTrkpt(trkpt, rawPoints);
        }
      }
    }
  } else {
    // <trk>が無いGPX(ルートのみのファイル)向けフォールバック
    for (const rte of directChildrenByLocalName(doc.documentElement, 'rte')) {
      for (const rtept of directChildrenByLocalName(rte, 'rtept')) {
        pushGpxTrkpt(rtept, rawPoints);
      }
    }
  }

  if (rawPoints.length === 0) {
    throw new Error('ルートの座標データが見つかりませんでした');
  }

  return buildTrackPointsWithHaversine(rawPoints);
}

function parseTcx(doc: Document): TrackPoint[] {
  const rawPoints: RawPoint[] = [];

  for (const tp of descendantsByLocalName(doc.documentElement, 'Trackpoint')) {
    const positionEl = directChildByLocalName(tp, 'Position');
    if (!positionEl) continue; // 位置情報の無いTrackpoint(心拍のみ等)はスキップ

    const lat = parseNumberContent(directChildByLocalName(positionEl, 'LatitudeDegrees'));
    const lon = parseNumberContent(directChildByLocalName(positionEl, 'LongitudeDegrees'));
    if (lat === undefined || lon === undefined || !isValidLatLon(lat, lon)) continue;

    const ele = parseNumberContent(directChildByLocalName(tp, 'AltitudeMeters'));
    const distanceMeters = parseNumberContent(directChildByLocalName(tp, 'DistanceMeters'));
    rawPoints.push({ lat, lon, ele, distanceMeters });
  }

  if (rawPoints.length === 0) {
    throw new Error('ルートの座標データが見つかりませんでした');
  }

  // DistanceMetersが全点で取得でき、かつ単調増加している場合のみそのまま採用する。
  // 複数Lap間で不連続/巻き戻りがある実装差が知られているため、条件を満たさなければ
  // GPXと同じHaversine積算にフォールバックする
  const hasAllDistances = rawPoints.every((p) => p.distanceMeters !== undefined);
  const isMonotonic =
    hasAllDistances &&
    rawPoints.every((p, i) => i === 0 || p.distanceMeters! >= rawPoints[i - 1].distanceMeters!);

  if (isMonotonic) {
    return rawPoints.map((p) => ({ x: p.lon, y: p.lat, d: p.distanceMeters, e: p.ele }));
  }
  return buildTrackPointsWithHaversine(rawPoints);
}

/** ファイル名から.gpx/.tcx拡張子を除去する(表示・エクスポートファイル名の整形で共用) */
export function stripRouteFileExtension(fileName: string): string {
  return fileName.replace(/\.(gpx|tcx)$/i, '');
}

function detectExtension(fileName: string): 'gpx' | 'tcx' | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.gpx')) return 'gpx';
  if (lower.endsWith('.tcx')) return 'tcx';
  return null;
}

/**
 * GPXまたはTCXのXML文字列を共通のTrackPoint[]形式に変換する。
 * ファイルの拡張子で一次判定し、ルート要素のタグ名で内容を検証する。
 */
export function parseGpxOrTcx(fileText: string, fileName: string): TrackPoint[] {
  const extension = detectExtension(fileName);
  if (!extension) {
    throw new Error('対応していないファイル形式です(.gpx または .tcx を選択してください)');
  }

  const doc = new DOMParser().parseFromString(fileText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('ファイルの読み込みに失敗しました(XMLとして解析できませんでした)');
  }

  const rootLocalName = doc.documentElement.localName;

  if (extension === 'gpx') {
    if (rootLocalName !== 'gpx') {
      throw new Error('拡張子は.gpxですが、内容がGPX形式ではありません');
    }
    return parseGpx(doc);
  }

  if (rootLocalName !== 'TrainingCenterDatabase') {
    throw new Error('拡張子は.tcxですが、内容がTCX形式ではありません');
  }
  return parseTcx(doc);
}

/** ファイル選択UIから直接呼ぶエントリポイント。サイズ上限チェック込み */
export async function parseUploadedFile(file: File): Promise<TrackPoint[]> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`ファイルサイズが大きすぎます(上限${Math.floor(MAX_FILE_SIZE_BYTES / 1024 / 1024)}MB)`);
  }
  const text = await file.text();
  return parseGpxOrTcx(text, file.name);
}

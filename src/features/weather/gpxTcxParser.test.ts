import { describe, expect, it } from 'vitest';
import { parseGpxOrTcx } from './gpxTcxParser';

const GPX_SIMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <trkseg>
      <trkpt lat="35.0000" lon="135.0000"><ele>10.0</ele></trkpt>
      <trkpt lat="35.0010" lon="135.0000"><ele>15.0</ele></trkpt>
      <trkpt lat="35.0020" lon="135.0000"><ele>20.0</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const GPX_MULTI_SEGMENT = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <trkseg>
      <trkpt lat="35.0000" lon="135.0000"><ele>10.0</ele></trkpt>
      <trkpt lat="35.0010" lon="135.0000"><ele>15.0</ele></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="35.0020" lon="135.0000"><ele>20.0</ele></trkpt>
      <trkpt lat="35.0030" lon="135.0000"><ele>25.0</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const GPX_NO_ELEVATION = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <trkseg>
      <trkpt lat="35.0000" lon="135.0000"></trkpt>
      <trkpt lat="35.0010" lon="135.0000"></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const GPX_INVALID_COORD = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <trkseg>
      <trkpt lat="35.0000" lon="135.0000"><ele>10.0</ele></trkpt>
      <trkpt lat="999.0" lon="135.0000"><ele>15.0</ele></trkpt>
      <trkpt lat="35.0020" lon="135.0000"><ele>20.0</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const GPX_ROUTE_ONLY = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <rte>
    <rtept lat="35.0000" lon="135.0000"><ele>10.0</ele></rtept>
    <rtept lat="35.0010" lon="135.0000"><ele>15.0</ele></rtept>
  </rte>
</gpx>`;

const GPX_EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <trkseg></trkseg>
  </trk>
</gpx>`;

const GPX_MALFORMED = `<?xml version="1.0" encoding="UTF-8"?><gpx><trk><trkseg><trkpt lat="35" lon="135">`;

// lat属性が欠落(コードレビュー[A-1]の回帰防止: Number(null)===0でisValidLatLonを通過してしまうバグ)
const GPX_MISSING_LAT_ATTR = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <trkseg>
      <trkpt lat="35.0000" lon="135.0000"><ele>10.0</ele></trkpt>
      <trkpt lon="135.0000"><ele>15.0</ele></trkpt>
      <trkpt lat="35.0020" lon="135.0000"><ele>20.0</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

// lat属性が空文字(コードレビュー[A-1]の回帰防止: Number('')===0で同様に通過してしまうバグ)
const GPX_EMPTY_LAT_ATTR = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <trkseg>
      <trkpt lat="35.0000" lon="135.0000"><ele>10.0</ele></trkpt>
      <trkpt lat="" lon="135.0000"><ele>15.0</ele></trkpt>
      <trkpt lat="35.0020" lon="135.0000"><ele>20.0</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

// <ele>要素はあるが中身が空(コードレビュー[A-3]の回帰防止: Number('')===0で標高0mとして誤受理されるバグ)
const GPX_EMPTY_ELEVATION = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <trkseg>
      <trkpt lat="35.0000" lon="135.0000"><ele></ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const TCX_MONOTONIC = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Biking">
      <Lap>
        <Track>
          <Trackpoint>
            <Position><LatitudeDegrees>35.0000</LatitudeDegrees><LongitudeDegrees>135.0000</LongitudeDegrees></Position>
            <AltitudeMeters>10.0</AltitudeMeters>
            <DistanceMeters>0</DistanceMeters>
          </Trackpoint>
          <Trackpoint>
            <Position><LatitudeDegrees>35.0010</LatitudeDegrees><LongitudeDegrees>135.0000</LongitudeDegrees></Position>
            <AltitudeMeters>15.0</AltitudeMeters>
            <DistanceMeters>111.2</DistanceMeters>
          </Trackpoint>
        </Track>
      </Lap>
      <Lap>
        <Track>
          <Trackpoint>
            <Position><LatitudeDegrees>35.0020</LatitudeDegrees><LongitudeDegrees>135.0000</LongitudeDegrees></Position>
            <AltitudeMeters>20.0</AltitudeMeters>
            <DistanceMeters>222.4</DistanceMeters>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

const TCX_NON_MONOTONIC = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Biking">
      <Lap>
        <Track>
          <Trackpoint>
            <Position><LatitudeDegrees>35.0000</LatitudeDegrees><LongitudeDegrees>135.0000</LongitudeDegrees></Position>
            <DistanceMeters>0</DistanceMeters>
          </Trackpoint>
          <Trackpoint>
            <Position><LatitudeDegrees>35.0010</LatitudeDegrees><LongitudeDegrees>135.0000</LongitudeDegrees></Position>
            <DistanceMeters>111.2</DistanceMeters>
          </Trackpoint>
        </Track>
      </Lap>
      <Lap>
        <Track>
          <!-- 2つ目のLapでDistanceMetersがリセットされ、1つ目より小さい値に戻る実装差を再現 -->
          <Trackpoint>
            <Position><LatitudeDegrees>35.0020</LatitudeDegrees><LongitudeDegrees>135.0000</LongitudeDegrees></Position>
            <DistanceMeters>0</DistanceMeters>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

const TCX_MISSING_POSITION = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Biking">
      <Lap>
        <Track>
          <Trackpoint>
            <HeartRateBpm><Value>120</Value></HeartRateBpm>
          </Trackpoint>
          <Trackpoint>
            <Position><LatitudeDegrees>35.0000</LatitudeDegrees><LongitudeDegrees>135.0000</LongitudeDegrees></Position>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

// Position要素はあるがLatitudeDegreesが空文字(コードレビュー[A-1]の回帰防止:
// GPX属性だけでなくTCX要素側にも同じ(0,0)誤受理の穴があった)
const TCX_EMPTY_LATITUDE = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Biking">
      <Lap>
        <Track>
          <Trackpoint>
            <Position><LatitudeDegrees>35.0000</LatitudeDegrees><LongitudeDegrees>135.0000</LongitudeDegrees></Position>
          </Trackpoint>
          <Trackpoint>
            <Position><LatitudeDegrees></LatitudeDegrees><LongitudeDegrees>135.0000</LongitudeDegrees></Position>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

// AltitudeMeters要素はあるが中身が空(コードレビュー[A-3]の回帰防止)
const TCX_EMPTY_ALTITUDE = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Biking">
      <Lap>
        <Track>
          <Trackpoint>
            <Position><LatitudeDegrees>35.0000</LatitudeDegrees><LongitudeDegrees>135.0000</LongitudeDegrees></Position>
            <AltitudeMeters></AltitudeMeters>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

describe('parseGpxOrTcx (GPX)', () => {
  it('parses a simple GPX track into TrackPoint[] with cumulative distance', () => {
    const points = parseGpxOrTcx(GPX_SIMPLE, 'route.gpx');
    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({ x: 135, y: 35, d: 0, e: 10 });
    expect(points[1].e).toBe(15);
    expect(points[1].d).toBeGreaterThan(0);
    expect(points[2].d).toBeGreaterThan(points[1].d!);
  });

  it('concatenates multiple trkseg into one continuous route', () => {
    const points = parseGpxOrTcx(GPX_MULTI_SEGMENT, 'route.gpx');
    expect(points).toHaveLength(4);
    // 距離は単調増加(セグメント境界でリセットされない)
    for (let i = 1; i < points.length; i++) {
      expect(points[i].d!).toBeGreaterThan(points[i - 1].d!);
    }
  });

  it('leaves elevation undefined when <ele> is missing', () => {
    const points = parseGpxOrTcx(GPX_NO_ELEVATION, 'route.gpx');
    expect(points).toHaveLength(2);
    expect(points[0].e).toBeUndefined();
  });

  it('skips points with out-of-range coordinates', () => {
    const points = parseGpxOrTcx(GPX_INVALID_COORD, 'route.gpx');
    expect(points).toHaveLength(2);
  });

  it('falls back to <rte><rtept> when no <trk> is present', () => {
    const points = parseGpxOrTcx(GPX_ROUTE_ONLY, 'route.gpx');
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ x: 135, y: 35, e: 10 });
  });

  it('throws when no track points are found', () => {
    expect(() => parseGpxOrTcx(GPX_EMPTY, 'route.gpx')).toThrow('座標データが見つかりませんでした');
  });

  it('throws on malformed XML', () => {
    expect(() => parseGpxOrTcx(GPX_MALFORMED, 'route.gpx')).toThrow('XMLとして解析できませんでした');
  });

  it('throws when extension is .gpx but content is not GPX', () => {
    expect(() => parseGpxOrTcx(TCX_MONOTONIC, 'route.gpx')).toThrow('内容がGPX形式ではありません');
  });

  it('rejects unsupported extensions', () => {
    expect(() => parseGpxOrTcx(GPX_SIMPLE, 'route.txt')).toThrow('対応していないファイル形式です');
  });

  it('skips points with a missing lat attribute instead of treating it as (0, 0)', () => {
    const points = parseGpxOrTcx(GPX_MISSING_LAT_ATTR, 'route.gpx');
    expect(points).toHaveLength(2);
    expect(points.some((p) => p.x === 0 && p.y === 0)).toBe(false);
  });

  it('skips points with an empty lat attribute instead of treating it as (0, 0)', () => {
    const points = parseGpxOrTcx(GPX_EMPTY_LAT_ATTR, 'route.gpx');
    expect(points).toHaveLength(2);
    expect(points.some((p) => p.x === 0 && p.y === 0)).toBe(false);
  });

  it('leaves elevation undefined when <ele> is present but empty', () => {
    const points = parseGpxOrTcx(GPX_EMPTY_ELEVATION, 'route.gpx');
    expect(points).toHaveLength(1);
    expect(points[0].e).toBeUndefined();
  });
});

describe('parseGpxOrTcx (TCX)', () => {
  it('uses DistanceMeters directly when monotonic across laps', () => {
    const points = parseGpxOrTcx(TCX_MONOTONIC, 'activity.tcx');
    expect(points).toHaveLength(3);
    expect(points.map((p) => p.d)).toEqual([0, 111.2, 222.4]);
    expect(points[0].e).toBe(10);
  });

  it('falls back to Haversine when DistanceMeters is non-monotonic across laps', () => {
    const points = parseGpxOrTcx(TCX_NON_MONOTONIC, 'activity.tcx');
    expect(points).toHaveLength(3);
    // フォールバック計算では距離が単調増加になる(生のDistanceMetersのリセットをそのまま使わない)
    expect(points[0].d).toBe(0);
    expect(points[1].d!).toBeGreaterThan(0);
    expect(points[2].d!).toBeGreaterThan(points[1].d!);
  });

  it('skips Trackpoints without a Position element', () => {
    const points = parseGpxOrTcx(TCX_MISSING_POSITION, 'activity.tcx');
    expect(points).toHaveLength(1);
  });

  it('throws when extension is .tcx but content is not TCX', () => {
    expect(() => parseGpxOrTcx(GPX_SIMPLE, 'activity.tcx')).toThrow('内容がTCX形式ではありません');
  });

  it('skips points with an empty LatitudeDegrees instead of treating it as (0, 0)', () => {
    const points = parseGpxOrTcx(TCX_EMPTY_LATITUDE, 'activity.tcx');
    expect(points).toHaveLength(1);
    expect(points.some((p) => p.x === 0 && p.y === 0)).toBe(false);
  });

  it('leaves elevation undefined when AltitudeMeters is present but empty', () => {
    const points = parseGpxOrTcx(TCX_EMPTY_ALTITUDE, 'activity.tcx');
    expect(points).toHaveLength(1);
    expect(points[0].e).toBeUndefined();
  });
});

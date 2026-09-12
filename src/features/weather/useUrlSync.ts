import { useCallback, useState } from 'react';
import { decodeParamsFromSearch, encodeParamsToSearch } from './urlState';
import type { RouteWeatherParams } from './types';

const EMPTY_PARAMS: RouteWeatherParams = {
  routeSource: null,
  selectedDate: '',
  selectedTime: '',
  averageSpeedKmh: null,
  arrivalCorrectionEnabled: true,
};

// URLで共有されたリンクを開いた場合、そのままの内容で復元する
function initialParamsFromUrl(): RouteWeatherParams {
  return decodeParamsFromSearch(window.location.search) ?? EMPTY_PARAMS;
}

/**
 * URLクエリパラメータとルート条件(RouteWeatherParams)の同期を管理するフック。
 * 初回ロード時にURLから状態を復元し、状態更新時にURLを更新(history.replaceState)する。
 */
export function useUrlSync() {
  const [params, setParamsState] = useState<RouteWeatherParams>(initialParamsFromUrl);

  const setParams = useCallback((nextParams: RouteWeatherParams) => {
    setParamsState(nextParams);
    // アカウント不要で結果を共有できるよう、URLに条件を反映する
    const search = encodeParamsToSearch(nextParams);
    window.history.replaceState(null, '', search ? `?${search}` : window.location.pathname);
  }, []);

  return [params, setParams] as const;
}

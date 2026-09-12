import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import 'dayjs/locale/ja'
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import '@fontsource/manrope/800.css'
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { theme } from './theme.ts'

// TanStack Queryの既定(networkMode: 'online')は、navigator.onLineがfalseになると
// クエリをfetchStatus: 'paused'のまま止め、isErrorにもisFetchingにもならない
// (オンライン復帰まで無言でハングする)。STEP3でオフライン向けの案内文言を
// routeQuery.isError/weatherQuery.isErrorを起点に出す設計にしたため、実際に
// fetch()を試行させて失敗をエラーとして扱う'always'に変更する
// (plans/STEP3_IMPLEMENTATION_PLAN.md 1.4節、実機検証で発見)
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: 'always' },
  },
})

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('#root element not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="ja">
          <QueryClientProvider client={queryClient}>
            <App />
          </QueryClientProvider>
        </LocalizationProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)

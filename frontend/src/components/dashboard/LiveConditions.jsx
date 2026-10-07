import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ExchangeRateCard from './ExchangeRateCard'

const WEATHER_ICONS = {
  clear: Sun,
  mainly_clear: Sun,
  partly_cloudy: CloudSun,
  overcast: Cloud,
  fog: CloudFog,
  drizzle: CloudRain,
  rain: CloudRain,
  thunderstorm: CloudLightning,
  snow: CloudSnow,
}

function formatUpdated(savedAt, t) {
  if (!savedAt) return null
  const date = new Date(savedAt)
  if (Number.isNaN(date.getTime())) return null
  return t('connection.lastUpdated', { time: date.toLocaleString() })
}

export default function LiveConditions({
  weather,
  exchange,
  weatherSavedAt,
  exchangeSavedAt,
  savedAt,
  isStale,
  isLoading,
}) {
  const { t } = useTranslation()
  const WeatherIcon = WEATHER_ICONS[weather?.condition] || CloudSun
  const weatherUpdated = isStale ? formatUpdated(weatherSavedAt || savedAt, t) : null
  const exchangeUpdated = isStale ? formatUpdated(exchangeSavedAt || savedAt, t) : null

  const showWeather = isLoading || Boolean(weather)
  // The shop rate is always known, so this card no longer waits on the live lookup.
  const showExchange = true
  const marketRate = Number(exchange?.khrPerUsd) > 0 ? Number(exchange.khrPerUsd) : null

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {showWeather ? (
      <div className="surface-card flex items-center gap-4 p-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white shadow-sm">
          <WeatherIcon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className="text-muted text-sm font-medium">{t('dashboard.weather')}</p>
          {isLoading ? (
            <p className="text-muted mt-1 text-sm">{t('dashboard.loadingLive')}</p>
          ) : weather ? (
            <>
              <p className="text-heading mt-1 text-2xl font-semibold tabular-nums">
                {weather.temperatureC}°C
              </p>
              {weatherUpdated ? <p className="text-muted mt-1 text-xs">{weatherUpdated}</p> : null}
            </>
          ) : null}
        </div>
      </div>
      ) : null}

      {showExchange ? (
      <ExchangeRateCard marketRate={marketRate} marketUpdated={exchangeUpdated} />
      ) : null}
    </div>
  )
}

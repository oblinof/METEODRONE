import { useState, useRef, useEffect } from 'react';
import { CloudRain, MapPin, Play, Square, Loader2, Thermometer, Droplets, Wind, Eye, Compass, Cloud, Sun, Sunrise, Activity, RadioReceiver } from 'lucide-react';
import { MeteoDrone, WeatherData } from './lib/audioEngine';

const GEOCODING_API = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_API = "https://api.open-meteo.com/v1/forecast";

export default function App() {
  const [city, setCity] = useState("Santa Fe, Argentina");
  const [activeCity, setActiveCity] = useState("Santa Fe, Argentina");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  const synthRef = useRef<MeteoDrone | null>(null);

  useEffect(() => {
    synthRef.current = new MeteoDrone();
    
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => {
      synthRef.current?.stop();
      clearInterval(timer);
    };
  }, []);

  const handleSearchAndPlay = async () => {
    if (!city.trim() || loading) return;
    setLoading(true);
    setError(null);
    
    try {
      const geoRes = await fetch(`${GEOCODING_API}?name=${encodeURIComponent(city)}&count=1`);
      const geoData = await geoRes.json();
      
      if (!geoData.results || geoData.results.length === 0) {
        throw new Error("CITY NOT FOUND.");
      }
      
      const { latitude, longitude, name, country } = geoData.results[0];
      const resolvedCity = `${name}, ${country}`.toUpperCase();
      setCity(resolvedCity);
      setActiveCity(resolvedCity);
      
      const weatherUrl = `${WEATHER_API}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,apparent_temperature,surface_pressure,weather_code,cloud_cover,is_day,dew_point_2m&timezone=auto`;
      const weatherRes = await fetch(weatherUrl);
      const weatherDataRaw = await weatherRes.json();
      const current = weatherDataRaw.current;
      
      const parsedWeather: WeatherData = {
        temperature: current.temperature_2m,
        humidity: current.relative_humidity_2m,
        windSpeed: current.wind_speed_10m,
        apparentTemperature: current.apparent_temperature,
        pressure: current.surface_pressure,
        windDirection: current.wind_direction_10m,
        weatherCode: current.weather_code,
        cloudCover: current.cloud_cover,
        isDay: current.is_day,
        dewPoint: current.dew_point_2m
      };
      
      setWeather(parsedWeather);
      
      if (synthRef.current) {
        await synthRef.current.updateParametersAndPlay(parsedWeather);
        setIsPlaying(true);
      }
      
    } catch (err: any) {
      console.error(err);
      setError(err.message || "DATA ERROR");
      setIsPlaying(false);
      if (synthRef.current) synthRef.current.stop();
    } finally {
      setLoading(false);
    }
  };

  const stopPlayback = async () => {
    if (synthRef.current) {
      await synthRef.current.stop();
    }
    setIsPlaying(false);
  };

  const timeString = currentTime.toLocaleTimeString('en-US', { hour12: true, hour: 'numeric', minute: '2-digit', second: '2-digit' }).toUpperCase();
  const dateString = currentTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();

  const getTickerText = () => {
    if (loading) return "/// FETCHING METEOROLOGICAL DATA... PLEASE STAND BY ///";
    if (error) return `/// SYSTEM ALERT: ${error} /// PLEASE ENTER ANOTHER LOCATION ///`;
    if (!weather || !isPlaying) return "/// ENTER LOCATION AND PRESS PLAY TO COMMENCE SYNTHESIS /// SOUND SCAPE GENERATOR ACTIVE ///";
    
    return `/// NOW SYNTHESIZING: ${activeCity} /// ${weather.isDay ? 'DAYTIME' : 'NIGHTTIME'} PROCEDURE /// TEMP: ${weather.temperature}°C /// HUMIDITY: ${weather.humidity}% /// WIND: ${weather.windSpeed} KM/H /// FM INDEX MAPPED TO TEMP /// FILTER CUTOFF MAPPED TO PRESSURE /// COMMENCING GENERATIVE CASCADE ///`;
  };

  const getGradientPalette = (weather: WeatherData | null, currentCity: string, isPlaying: boolean) => {
    if (!weather || !currentCity || !isPlaying) return 'linear-gradient(135deg, #181156 0%, #aa4c04 40%, #cc6a12 55%, #76222b 75%, #2a1b5c 100%)';
    
    let hash = 0;
    const lowerCity = currentCity.toLowerCase();
    for (let i = 0; i < lowerCity.length; i++) {
        hash = lowerCity.charCodeAt(i) + ((hash << 5) - hash);
    }
    hash = Math.abs(hash);
    
    const t = weather.temperature;
    
    let baseHue = hash % 360;
    let hueOffset1 = (hash % 60) + 20; 
    let hueOffset2 = ((hash >> 2) % 90) + 30; 
    let hueOffset3 = ((hash >> 4) % 120) + 60; 
    
    let sBase = weather.isDay ? 80 : 50;
    let lBase = weather.isDay ? 55 : 20;
    
    let tempBonus = Math.max(-20, Math.min(20, t - 15)); 
    sBase = Math.max(30, Math.min(100, sBase + tempBonus));
    lBase = Math.max(10, Math.min(80, lBase + (tempBonus / 2)));
    
    const color1 = `hsl(${baseHue}, ${sBase}%, ${lBase}%)`;
    const color2 = `hsl(${(baseHue + hueOffset1) % 360}, ${Math.min(100, sBase + 15)}%, ${Math.min(100, lBase + 10)}%)`;
    const color3 = `hsl(${(baseHue + hueOffset2) % 360}, ${sBase}%, ${Math.max(0, lBase - 5)}%)`;
    const color4 = `hsl(${(baseHue + hueOffset3) % 360}, ${Math.min(100, sBase + 10)}%, ${Math.max(0, Math.min(100, lBase + 15))}%)`;
    const color5 = `hsl(${(baseHue + 180) % 360}, ${Math.max(0, sBase - 15)}%, ${Math.max(0, lBase - 10)}%)`;
    
    return `linear-gradient(135deg, ${color1} 0%, ${color2} 25%, ${color3} 50%, ${color4} 75%, ${color5} 100%)`;
  };

  return (
    <div className="h-screen w-full flex flex-col font-sans overflow-hidden bg-[#272153] bg-pan-overlay transition-all duration-1000" style={{ backgroundImage: getGradientPalette(weather, activeCity, isPlaying) }}>
      
      {/* Header */}
      <header className="h-[12%] min-h-[90px] bg-[#1e1c66] flex items-center justify-between px-2 sm:px-6 border-b-4 border-black relative z-20 shrink-0 shadow-2xl">
        <div className="flex items-center gap-4 h-[75%] max-h-[80px]">
          <div className="h-full aspect-square bg-[#0b7fbf] border-2 border-black flex flex-col items-center justify-center relative shadow-[2px_2px_0px_rgba(0,0,0,0.8)]">
            <span className="text-4xl sm:text-5xl leading-none font-bold text-white text-border drop-shadow-md">89</span>
            <div className="absolute -bottom-1 w-full bg-black text-center pb-0.5">
              <span className="text-[10px] sm:text-xs text-[#0ecbf4] tracking-wider leading-none font-bold block">METEODRONE</span>
            </div>
          </div>
          <div className="flex flex-col justify-center leading-[1.1]">
            <h1 className="text-2xl sm:text-4xl text-[#f3ce36] text-border font-bold tracking-wide">Ambient</h1>
            <h1 className="text-2xl sm:text-4xl text-[#f3ce36] text-border font-bold tracking-wide">Forecast</h1>
          </div>
        </div>
        
        <div className="flex flex-col items-end gap-1 sm:gap-2">
          <div className="flex lg:absolute lg:top-1/2 lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 z-30 shadow-[2px_2px_0px_#000]">
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleSearchAndPlay()}
              placeholder="SEARCH CITY..."
              className="bg-[#111] text-white font-bold text-border uppercase px-3 py-1 w-32 sm:w-48 lg:w-64 outline-none placeholder-white/50 border-y-2 border-l-2 border-white/20 text-sm sm:text-lg focus:bg-[#222]"
            />
            <button
              onClick={isPlaying ? stopPlayback : handleSearchAndPlay}
              disabled={loading}
              className={`border-y-2 border-r-2 border-white/20 px-3 sm:px-6 text-white text-border font-bold uppercase transition-colors shrink-0 text-sm sm:text-lg ${
                isPlaying ? 'bg-[#990000] hover:bg-[#ff0000]' : 'bg-[#0077cc] hover:bg-[#0099ff]'
              } disabled:opacity-80`}
            >
              {loading ? '...' : isPlaying ? 'STOP' : 'PLAY'}
            </button>
          </div>
          
          <div className="text-white text-xl sm:text-2xl lg:text-3xl text-border font-bold flex flex-col items-end leading-none align-bottom justify-end h-full mt-auto">
            <span className="flex items-center gap-2">
              <CloudRain className="w-5 h-5 sm:w-7 sm:h-7 text-[#0ecbf4]" /> 
              {timeString}
            </span>
            <span className="text-white">{dateString}</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-2 sm:p-4 overflow-hidden">
        {weather && isPlaying ? (
          <div className="flex flex-row gap-2 sm:gap-6 w-full max-w-5xl justify-center h-[90%] max-h-[500px]">
            
            {/* Card 1 */}
            <div className="flex-1 max-w-[280px] bg-[#1a2bce] card-border flex flex-col relative py-8 px-4 items-center">
              <div className="absolute top-0 -translate-y-1/2 bg-black px-2 pb-1">
                <span className="text-white text-xl sm:text-2xl text-border font-bold tracking-widest uppercase">CLIMATE</span>
              </div>
              
              <div className="w-full flex-1 flex flex-col items-center justify-center gap-6 sm:gap-8">
                {weather.isDay ? <Sun className="w-20 h-20 sm:w-24 sm:h-24 text-[#f3ce36] drop-shadow-[2px_2px_0px_#000]" /> : <Cloud className="w-20 h-20 sm:w-24 sm:h-24 text-white drop-shadow-[2px_2px_0px_#000]" />}
                
                <div className="w-full flex flex-col gap-2">
                  <div className="flex justify-between items-end border-b-2 border-white/30 pb-1">
                    <span className="text-white text-border font-semibold text-lg sm:text-xl">TEMP:</span>
                    <span className="text-white text-border font-bold text-2xl sm:text-3xl">{weather.temperature}°</span>
                  </div>
                  <div className="flex justify-between items-end border-b-2 border-white/30 pb-1">
                    <span className="text-white text-border font-semibold text-lg sm:text-xl">FEELS:</span>
                    <span className="text-[#a0a0b2] text-border font-bold text-2xl sm:text-3xl">{weather.apparentTemperature}°</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 2 */}
            <div className="flex-1 max-w-[280px] bg-[#1a2bce] card-border flex flex-col relative py-8 px-4 items-center">
              <div className="absolute top-0 -translate-y-1/2 bg-black px-2 pb-1">
                <span className="text-white text-xl sm:text-2xl text-border font-bold tracking-widest uppercase">AIR</span>
              </div>
              
              <div className="w-full flex-1 flex flex-col items-center justify-center gap-6 sm:gap-8">
                <Wind className="w-20 h-20 sm:w-24 sm:h-24 text-white drop-shadow-[2px_2px_0px_#000]" />
                
                <div className="w-full flex flex-col gap-2">
                  <div className="flex justify-between items-end border-b-2 border-white/30 pb-1">
                    <span className="text-white text-border font-semibold text-lg sm:text-xl">WIND:</span>
                    <span className="text-white text-border font-bold text-2xl sm:text-3xl">{weather.windSpeed}</span>
                  </div>
                  <div className="flex justify-between items-end border-b-2 border-white/30 pb-1">
                    <span className="text-white text-border font-semibold text-lg sm:text-xl">DIR:</span>
                    <span className="text-[#a0a0b2] text-border font-bold text-2xl sm:text-3xl">{weather.windDirection}°</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 3 */}
            <div className="flex-1 max-w-[280px] hidden sm:flex bg-[#1a2bce] card-border flex-col relative py-8 px-4 items-center">
              <div className="absolute top-0 -translate-y-1/2 bg-black px-2 pb-1">
                <span className="text-white text-xl sm:text-2xl text-border font-bold tracking-widest uppercase">SYNTHESIS</span>
              </div>
              
              <div className="w-full flex-1 flex flex-col justify-start gap-4 h-full mt-4">
                <div className="w-full bg-[#111] border-2 border-black p-2 shadow-inner text-center">
                  <RadioReceiver className="w-8 h-8 text-[#0ecbf4] mx-auto mb-2 animate-pulse" />
                  <p className="text-white text-border text-sm leading-tight text-left mb-1">PITCH ⏤ {weather.temperature}°</p>
                  <p className="text-white text-border text-sm leading-tight text-left mb-1">REVRB ⏤ {weather.humidity}%</p>
                  <p className="text-white text-border text-sm leading-tight text-left mb-1">SPEED ⏤ {weather.windSpeed}K</p>
                  <p className="text-white text-border text-sm leading-tight text-left mb-1">F.MOD ⏤ {weather.apparentTemperature}°</p>
                  <p className="text-white text-border text-sm leading-tight text-left mb-1">CUTOFF ⏤ {weather.pressure}H</p>
                </div>
                <div className="mt-auto text-center">
                   <div className="text-white text-border font-bold text-3xl animate-pulse">ACTIVE</div>
                </div>
              </div>
            </div>

          </div>
        ) : (
          <div className="w-full max-w-xl bg-black/40 border-4 border-black p-8 text-center shadow-[4px_4px_0_rgba(0,0,0,0.5)]">
             <RadioReceiver className="w-24 h-24 text-white/50 mx-auto mb-6" />
             <h2 className="text-white text-4xl text-border font-bold mb-4">AWAITING INPUT</h2>
             <p className="text-white/80 text-2xl font-semibold">ENTER A CITY AND PRESS PLAY TO BEGIN WEATHER DRIVEN FM SYNTHESIS.</p>
          </div>
        )}
      </main>

      {/* Ticker Bottom Bar */}
      <footer className="h-14 sm:h-20 bg-[#16175e] border-t-2 border-black flex items-center overflow-hidden relative shrink-0 shadow-[inset_0_2px_0_rgba(255,255,255,0.4)]">
        <div className="animate-marquee whitespace-nowrap text-3xl sm:text-5xl font-semibold text-white tracking-widest text-border px-4 py-1 flex h-full items-center">
           {getTickerText()}
        </div>
      </footer>
    </div>
  );
}

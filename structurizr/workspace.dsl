workspace "Sunnyview" "Rooftop solar feasibility demo (SF Hacks 2026)." {

    model {
        user = person "Homeowner / Judge" "Traces a roof and gets quick panel, energy, and CO2 estimates."

        sunnyview = softwareSystem "Sunnyview" "Fast rooftop solar feasibility demo." "Internal" {
            group "Client" {
                web = container "Web Client" "Search + trace roof polygon; runs deterministic panel packing locally in the browser." "Next.js (React in browser)" "Web"
            }

            group "Server" {
                api = container "API / BFF" "Next.js route handlers that proxy external APIs, rate limit, cache, and hide keys." "Next.js Route Handlers (Node.js)" "API"
                segmenter = container "CV Segmenter" "Optional auto-outline service (roof + obstacles) for /api/segment." "Python (FastAPI)" "ML,Optional"
            }

            group "Persistence (Optional)" {
                mongo = container "History Store" "Optional persistence for /api/history (per-visitor Solar Snapshot history)." "MongoDB" "Database,Optional"
                redis = container "Cache" "Optional Redis cache for PVWatts estimates (24h)." "Upstash Redis" "Cache,Optional"
            }
        }

        group "External Services" {
            geoApis = softwareSystem "Geospatial APIs (ArcGIS + OSM)" "Geocoding, satellite imagery export, and building footprints (with fallbacks)." "External"
            solarWeatherApis = softwareSystem "Solar + Weather APIs (PVWatts + Open-Meteo)" "Energy yield + forecast/archive used by estimates and panel recommendations." "External"
            aiVoiceApis = softwareSystem "AI + Voice APIs (Gemini + ElevenLabs)" "Optional recommendations and narration." "External,Optional"
            externalBackend = softwareSystem "Sunnyview Backend" "Optional separate backend for project CRUD and share snapshots." "External,Optional"
        }

        user -> web "Uses" "Browser"

        web -> api "Calls /api/* route handlers" "HTTPS (JSON)"
        web -> externalBackend "Optional: calls /api/projects and /s/:shareSlug" "HTTPS (JSON)" {
            tags "Optional"
        }

        api -> geoApis "Geocode, imagery, and footprints" "HTTPS"
        api -> segmenter "POST /api/segment (CV auto-outline)" "HTTP" {
            tags "Optional"
        }

        api -> solarWeatherApis "Estimates + forecast" "HTTPS"
        api -> aiVoiceApis "Recommendations + narration" "HTTPS" {
            tags "Optional"
        }

        api -> mongo "Reads/writes history" "MongoDB" {
            tags "Optional"
        }

        api -> redis "Caches PVWatts results" "Redis" {
            tags "Optional"
        }
    }

    views {
        branding {
            font "Space Grotesk" "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600&display=swap"
        }

        container sunnyview "general-architecture" {
            title "SUNNYVIEW / GENERAL ARCHITECTURE"
            include *
            autolayout tb 220 140
        }

        dynamic sunnyview "main-feature" "Trace roof -> panel layout -> estimate" {
            title "SUNNYVIEW / MAIN FEATURE: TRACE ROOF -> ESTIMATE"

            1: user -> web "Enter address"
            2: web -> api "GET /api/geocode (suggest)"
            3: api -> arcgisGeocode "Suggest/Find (primary)"
            4: api -> nominatim "Fallback search"

            5: web -> api "GET /api/geocode (lookup)"
            6: api -> arcgisGeocode "Lookup candidates"

            7: web -> api "GET /api/static-map"
            8: api -> arcgisImagery "Export image"
            9: api -> mapboxStatic "Fallback image (optional)"

            10: user -> web "Trace roof polygon"
            11: web -> api "POST /api/segment (optional)"
            12: api -> segmenter "CV outline (optional)"
            13: api -> overpass "Footprint fallback"

            14: user -> web "Tune assumptions"
            15: web -> api "POST /api/estimate"
            16: api -> redis "Read cache (optional)"
            17: api -> pvwatts "PVWatts (if needed)"
            18: api -> redis "Write cache (optional)"

            19: web -> api "GET /api/forecast (optional)"
            20: api -> openMeteo "Forecast + archive"

            21: web -> api "POST /api/history (optional)"
            22: api -> mongo "Upsert snapshot (optional)"

            23: web -> api "POST /api/panel-recommend (optional)"
            24: api -> gemini "Generate recommendation (optional)"

            25: web -> api "POST /api/tts (optional)"
            26: api -> elevenlabs "Text-to-speech (optional)"

            autolayout tb 170 120
        }

        styles {
            element "Element" {
                shape RoundedBox
                background #0B1220
                color #E2E8F0
                stroke #334155
                strokeWidth 2
                fontSize 26
            }

            element "Boundary" {
                background #05060A
                color #94A3B8
                stroke #334155
                strokeWidth 2
            }

            element "Group" {
                background #05060A
                color #94A3B8
                stroke #334155
                strokeWidth 2
                border Dashed
            }

            element "Person" {
                shape Person
                background #0B1220
                color #F8FAFC
                stroke #38BDF8
                strokeWidth 2
            }

            element "Web" {
                shape WebBrowser
                background #2563EB
                color #F8FAFC
            }

            element "API" {
                shape Hexagon
                background #0F766E
                color #F8FAFC
            }

            element "ML" {
                shape RoundedBox
                background #B45309
                color #F8FAFC
            }

            element "Database" {
                shape Cylinder
                background #0B1220
                color #F8FAFC
                stroke #F59E0B
                strokeWidth 2
            }

            element "Cache" {
                shape Cylinder
                background #0B1220
                color #F8FAFC
                stroke #38BDF8
                strokeWidth 2
            }

            element "External" {
                background #0B1220
                color #CBD5E1
                stroke #64748B
                strokeWidth 2
                border Dashed
            }

            element "Optional" {
                opacity 70
            }

            relationship "Relationship" {
                thickness 2
                color #94A3B8
                routing Orthogonal
                fontSize 18
            }

            relationship "Optional" {
                style Dashed
                color #64748B
            }
        }
    }
}

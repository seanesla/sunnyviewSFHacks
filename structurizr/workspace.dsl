workspace "Sunnyview" "Rooftop solar feasibility demo (SF Hacks 2026)." {

    model {
        user = person "Homeowner" "Traces a roof and gets quick panel, energy, and CO2 estimates."

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

        user -> web "Uses"

        web -> api "Calls /api/*"
        web -> externalBackend "Optional: projects + share" {
            tags "Optional"
        }

        api -> geoApis "Geocode + imagery + footprints"
        api -> segmenter "Optional: CV auto-outline" {
            tags "Optional"
        }

        api -> solarWeatherApis "Estimate + forecast"
        api -> aiVoiceApis "Recommendations + narration" {
            tags "Optional"
        }

        api -> mongo "Optional: history snapshots" {
            tags "Optional"
        }

        api -> redis "Optional: PVWatts cache" {
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
            properties {
                "structurizr.boundaryPadding" "8"
            }
            autolayout tb 150 120
        }

        dynamic sunnyview "main-feature" "Trace roof -> panel layout -> estimate" {
            title "SUNNYVIEW / MAIN FEATURE: TRACE ROOF -> ESTIMATE"

            1: user -> web "Trace roof; web packs panels"
            2: web -> api "Call /api/*"
            3: api -> geoApis "Geocode + imagery + footprints"
            4: api -> solarWeatherApis "Estimate + forecast"
            5: api -> segmenter "Optional CV outline"
            6: api -> aiVoiceApis "Optional AI + TTS"

            properties {
                "structurizr.boundaryPadding" "8"
            }
            autolayout lr 140 90
        }

        styles {
            element "Element" {
                shape RoundedBox
                background #0B1220
                color #E2E8F0
                stroke #334155
                strokeWidth 2
                fontSize 36
                description false
                metadata false
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
                shape RoundedBox
                background #0B1220
                color #F8FAFC
                stroke #38BDF8
                strokeWidth 3
            }

            element "Web" {
                shape WebBrowser
                background #0B1220
                color #F8FAFC
                stroke #38BDF8
                strokeWidth 3
            }

            element "API" {
                shape Hexagon
                background #0B1220
                color #F8FAFC
                stroke #38BDF8
                strokeWidth 3
            }

            element "ML" {
                shape RoundedBox
                background #0B1220
                color #F8FAFC
                stroke #F59E0B
                strokeWidth 3
                border Dashed
            }

            element "Database" {
                shape Cylinder
                background #0B1220
                color #F8FAFC
                stroke #F59E0B
                strokeWidth 3
            }

            element "Cache" {
                shape Cylinder
                background #0B1220
                color #F8FAFC
                stroke #F59E0B
                strokeWidth 3
            }

            element "External" {
                background #0B1220
                color #CBD5E1
                stroke #64748B
                strokeWidth 2
                border Dashed
            }

            element "Optional" {
                opacity 78
                stroke #F59E0B
                strokeWidth 3
                border Dashed
            }

            relationship "Relationship" {
                thickness 5
                color #94A3B8
                routing Orthogonal
                fontSize 1
            }

            relationship "Optional" {
                style Dashed
                color #64748B
            }
        }
    }
}

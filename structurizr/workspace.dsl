workspace "Sunnyview" "Rooftop solar feasibility demo (SF Hacks 2026)." {

    model {
        user = person "Homeowner" "Traces a roof and gets quick panel, energy, and CO2 estimates."

        sunnyview = softwareSystem "Sunnyview" "Fast rooftop solar feasibility demo." "Internal" {
            web = container "Web Client" "Search + trace roof polygon; runs deterministic panel packing locally in the browser." "Next.js (React in browser)" "Web"
            api = container "API / BFF" "Next.js route handlers that proxy external APIs, rate limit, cache, and hide keys." "Next.js Route Handlers (Node.js)" "API"
            segmenter = container "CV Segmenter" "Optional auto-outline service (roof + obstacles) for /api/segment." "Python (FastAPI)" "ML,Optional"
            mongo = container "MongoDB" "Optional persistence for /api/history (per-visitor Solar Snapshot history)." "MongoDB" "Database,Optional"
            redis = container "Upstash Redis" "Optional cache for PVWatts estimates (24h)." "Upstash Redis" "Cache,Optional"
        }

        geoApis = softwareSystem "Geospatial APIs (ArcGIS + OSM)" "Geocoding, satellite imagery export, and building footprints (with fallbacks)." "External"
        solarWeatherApis = softwareSystem "Solar + Weather APIs (PVWatts + Open-Meteo)" "Energy yield + forecast/archive used by estimates and panel recommendations." "External"
        aiVoiceApis = softwareSystem "AI + Voice APIs (Gemini + ElevenLabs)" "Optional recommendations and narration." "External,Optional"
        externalBackend = softwareSystem "Sunnyview Backend" "Optional separate backend for project CRUD and share snapshots." "External,Optional"

        user -> web

        web -> api
        web -> externalBackend {
            tags "Optional"
        }

        api -> geoApis
        api -> segmenter {
            tags "Optional"
        }

        api -> solarWeatherApis
        api -> aiVoiceApis {
            tags "Optional"
        }

        api -> mongo {
            tags "Optional"
        }

        api -> redis {
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
            autolayout tb 220 170
        }

        container sunnyview "main-feature" {
            title "SUNNYVIEW / MAIN FEATURE: TRACE ROOF -> ESTIMATE"
            include user
            include web
            include api
            include segmenter
            include mongo
            include redis
            include geoApis
            include solarWeatherApis
            include aiVoiceApis
            autolayout lr 240 180
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
                color #05060A
                stroke #05060A
                strokeWidth 1
            }

            element "Boundary:Software System" {
                background #05060A
                color #05060A
                stroke #05060A
                strokeWidth 1
            }

            element "Boundary:Container" {
                background #05060A
                color #05060A
                stroke #05060A
                strokeWidth 1
            }

            element "Group" {
                background #05060A
                color #05060A
                stroke #05060A
                strokeWidth 1
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
                routing Direct
                fontSize 16
            }

            relationship "Optional" {
                style Dashed
                color #64748B
            }
        }
    }
}

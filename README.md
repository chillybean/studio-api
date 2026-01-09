# Studio API

Studio management microservice for Tat-Life - handles tattoo studio operations including AI design generation, customer CRM, appointments, pricelist, and analytics.

## 🎨 Features

### AI Design Generator
- **Design Suggestions**: Generate detailed tattoo design concepts based on user input
- **Style Recommendations**: Get personalized style recommendations with match scores
- **Placement Advice**: Optimal body placement suggestions
- **Cost Estimation**: Price estimates based on design complexity
- **Consultation Chat**: AI-powered tattoo consultation

### Customer CRM
- Full CRUD operations for customer management
- Customer notes and preferences
- Visit history and spending tracking
- Source attribution (walk-in, referral, social media, etc.)

### Appointments
- Calendar-based appointment scheduling
- Status tracking (scheduled, confirmed, completed, cancelled, no-show)
- Availability checking
- Artist assignment
- Deposit tracking

### Pricelist
- Dynamic service pricing
- Multiple pricing types (fixed, hourly, starting-at)
- Category organization
- Deposit configuration
- Cost estimation

### Gallery
- Portfolio management
- Featured items
- Public/private visibility
- Style and artist tagging

### Analytics
- Revenue tracking
- Appointment statistics
- Customer insights
- Performance metrics

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your settings

# Copy service account from another API
cp ../content-api/secrets/service-account.json ./secrets/

# Run development server
npm run dev
```

## 📡 API Endpoints

### AI Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ai/generate-design` | Generate tattoo design suggestion |
| POST | `/api/ai/style-recommendation` | Get style recommendations |
| POST | `/api/ai/placement-advice` | Get placement advice |
| POST | `/api/ai/estimate-cost` | Estimate tattoo cost |
| POST | `/api/ai/chat` | AI consultation chat |
| GET | `/api/ai/status` | Check AI service status |

### Customer Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/customers` | List customers |
| GET | `/api/customers/:id` | Get customer details |
| POST | `/api/customers` | Create customer |
| PUT | `/api/customers/:id` | Update customer |
| DELETE | `/api/customers/:id` | Delete customer |
| POST | `/api/customers/:id/notes` | Add customer note |
| GET | `/api/customers/stats/overview` | Customer statistics |

### Appointment Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/appointments` | List appointments |
| GET | `/api/appointments/calendar/:year/:month` | Calendar view |
| GET | `/api/appointments/:id` | Get appointment |
| POST | `/api/appointments` | Create appointment |
| PUT | `/api/appointments/:id` | Update appointment |
| PATCH | `/api/appointments/:id/status` | Update status |
| DELETE | `/api/appointments/:id` | Cancel appointment |
| GET | `/api/appointments/availability/:date` | Check availability |

### Pricelist Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pricelist` | List services |
| POST | `/api/pricelist` | Create service |
| PUT | `/api/pricelist/:id` | Update service |
| DELETE | `/api/pricelist/:id` | Delete service |
| POST | `/api/pricelist/reorder` | Reorder services |
| POST | `/api/pricelist/estimate` | Calculate estimate |

### Gallery Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/gallery` | List gallery items |
| GET | `/api/gallery/public/:studioId` | Public gallery |
| POST | `/api/gallery` | Add item |
| PUT | `/api/gallery/:id` | Update item |
| DELETE | `/api/gallery/:id` | Delete item |
| POST | `/api/gallery/:id/feature` | Toggle featured |

### Analytics Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/analytics/overview` | Dashboard overview |
| GET | `/api/analytics/revenue` | Revenue analytics |
| GET | `/api/analytics/appointments` | Appointment stats |
| GET | `/api/analytics/customers` | Customer analytics |

### Settings Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings` | Get studio settings |
| PUT | `/api/settings` | Update settings |
| GET | `/api/settings/public/:studioId` | Public studio info |
| POST | `/api/settings/working-hours` | Update hours |
| POST | `/api/settings/booking` | Update booking settings |
| POST | `/api/settings/ai-key` | Update AI API key |

## 🔐 Authentication

All endpoints except public ones require:
- `x-studio-id`: Studio identifier in header

For AI endpoints, you need:
- `GEMINI_API_KEY`: Google Gemini API key in environment

## 🏗️ Architecture

```
studio-api/
├── src/
│   ├── index.ts           # Express app entry
│   ├── config/
│   │   └── firebase.ts    # Firebase initialization
│   └── routes/
│       ├── ai.ts          # AI design generation
│       ├── customers.ts   # Customer CRM
│       ├── appointments.ts # Appointment management
│       ├── pricelist.ts   # Service pricing
│       ├── gallery.ts     # Portfolio management
│       ├── analytics.ts   # Analytics & reports
│       └── settings.ts    # Studio settings
├── secrets/
│   └── service-account.json
├── package.json
└── tsconfig.json
```

## 🔥 Firestore Collections

```
studios/{studioId}/
├── customers/{customerId}
│   └── notes/{noteId}
├── appointments/{appointmentId}
├── services/{serviceId}
├── gallery/{itemId}
└── artists/{artistId}

ai_generations/  # AI usage tracking
```

## 📦 Deployment

```bash
# Build
npm run build

# Deploy to Cloud Run
gcloud run deploy studio-api \
  --source . \
  --region us-central1 \
  --allow-unauthenticated
```

## 🧪 Testing

```bash
# Health check
curl http://localhost:3007/health

# AI status
curl http://localhost:3007/api/ai/status

# Generate design
curl -X POST http://localhost:3007/api/ai/generate-design \
  -H "Content-Type: application/json" \
  -d '{"description": "A wolf howling at the moon with mountains"}'
```

## 📄 License

MIT - Ported from [Tattoo Workshop](https://github.com/Tattoo-Workshop) open source project.

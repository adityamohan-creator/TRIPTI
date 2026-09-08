# TRIPTI — Product Requirements

> Source of truth. Authored by Aditya Mohan. Transcribed here so the repository
> carries its own specification. Where implementation decisions narrow or
> interpret a requirement, that is recorded in
> [GAP-ANALYSIS.md](GAP-ANALYSIS.md) and [ARCHITECTURE.md](ARCHITECTURE.md) —
> never silently.

## 1. Executive summary

An AI-powered emergency coordination platform that converts crisis reports into
executable response missions. It combines three capabilities: AI crisis
intelligence, disaster resource coordination, and surplus-food-to-need matching.
The platform identifies what is happening, prioritizes incidents, finds suitable
resources, assigns volunteers and vehicles, optimizes delivery routes, tracks
missions, and measures impact.

```
Crisis → AI Understanding → Priority → Resource Matching → Response Plan
       → Volunteer/Vehicle Assignment → Route → Delivery → Impact
```

## 2. Problem

During disasters, information, resources, volunteers, food donors, NGOs,
shelters, and vehicles are fragmented across different people and organizations.
Surplus food expires while nearby affected communities lack meals. Manual
coordination is slow, inconsistent, and hard to scale.

- Emergency requests are not structured or prioritized.
- Resources are scattered and may not reach the highest-priority need.
- Surplus food has a short usable window.
- Volunteer and vehicle assignment is manual.
- Response teams lack a single live operational view.
- Shortages become visible only after demand rises.

## 3. Solution

A unified command-and-coordination layer. Anyone may submit information in
natural language. AI converts it into structured data, the platform calculates
priority, recommends a response plan, and coordinates resources through rules and
optimization algorithms. **Human operators remain in control before real-world
execution.**

## 4. Objectives

- Reduce time between crisis reporting and resource allocation.
- Prioritize incidents by severity, people affected, urgency, and shortages.
- Reduce food waste by matching surplus food with nearby high-priority needs.
- Improve utilization of volunteers, vehicles, shelters, food, water, medical supplies.
- Provide real-time mission and resource visibility.
- Predict likely shortages and support proactive preparation.
- Create measurable social and environmental impact analytics.

## 5. Target users

Emergency operators / command centres · NGOs and relief organizations ·
restaurants, hotels, caterers and food donors · volunteers and delivery teams ·
shelters and community centres · resource suppliers and warehouses · citizens
reporting emergencies.

## 6. Major features

| Feature | Description |
| --- | --- |
| AI Crisis Analyzer | Natural-language reports → crisis type, location, severity, affected population, required resources, urgency |
| AI Priority Engine | Ranks incidents by severity, people affected, shortage, time sensitivity, vulnerability, proximity |
| Response Plan Generator | Recommended plan: resources, volunteers, vehicles, route, ETA, coverage, shortages |
| Smart Resource Matching | Matches demand with suitable food, water, shelters, vehicles, volunteers |
| Food Waste → Need Matching | Matches surplus food using quantity, distance, expiry, priority, transport |
| Smart Volunteer Assignment | Recommends volunteers by distance, availability, skills, requirements |
| Route Optimization | Multi-stop pickup/delivery routes under distance, deadline, capacity, priority |
| Live Crisis Map | Incidents, resources, shelters, volunteers, vehicles, active missions |
| Mission Tracking | Pickup → assignment → transit → delivery → verification → completion |
| Dynamic Resource Reallocation | Reallocates uncommitted resources when a more critical incident appears |
| Shortage Prediction | Forecasts demand and warns operators |
| What-if Simulator | Simulates a scenario; compares coverage, time, shortages, utilization |
| Trust & Fraud Detection | Flags duplicates, suspicious quantities, repeated or inconsistent claims |
| Voice + Multilingual Reporting | Spoken or multilingual reports converted into structured requests |
| Impact Analytics | People helped, meals redistributed, waste prevented, water delivered, response time, volunteer contribution |

### Killer features

One-click AI response plan · dynamic resource reallocation · AI shortage
forecasting · what-if crisis simulator · voice emergency reporting.

## 7. End-to-end workflow

1. Crisis report submitted by citizen, operator, NGO, or simulated feed.
2. AI Crisis Analyzer extracts type, location, severity, affected people, needs, urgency.
3. Priority Engine scores it into the response queue.
4. Matching Engine searches the resource pool.
5. Food matching gives near-expiry surplus higher importance.
6. Response Planner generates a recommended allocation and mission plan.
7. Volunteer/vehicle assignment selects feasible personnel and transport.
8. Route Engine generates pickup and delivery routes.
9. **Operator reviews and approves.**
10. Mission executes; status tracked in real time.
11. Delivery verified (confirmation / OTP / photo / simulated).
12. Impact dashboard updates.
13. Forecasting identifies remaining shortages or future demand.

## 8. Architecture

```
Frontend (React + Tailwind)
   → API Layer (Node.js + Express)
   → Auth/Database (Supabase/PostgreSQL)
   → AI Service (LLM API)
   → Matching/Priority/Optimization Services
   → Maps/Routing API
   → Realtime Events → Dashboards
```

Decision engine is deterministic. **An LLM alone must not make operational
allocation decisions.**

## 9. Tech stack

React + Vite + Tailwind + TypeScript + Leaflet/Mapbox · Node + Express REST ·
Supabase Postgres + Auth + Realtime · LLM API · Mapbox/Google Maps + directions
and distance matrix · greedy matching for MVP, OR-Tools for advanced routing ·
Recharts · Vercel + Render/Railway + Supabase · Git/GitHub.

## 10. Database entities

`users` · `incidents` · `needs` · `resources` · `matches` · `volunteers` ·
`vehicles` · `missions` · `routes` · `status_history` · `impact_metrics`.

Extended in implementation with `profiles`, `food_listings`, `mission_stops`,
`response_plans`, `notifications`, `audit_logs`.

## 11. AI and decision logic

AI for unstructured understanding and recommendations; deterministic rules for
safety-critical decisions.

```
Priority = 0.30×Severity + 0.25×PeopleAffected + 0.20×Urgency
         + 0.15×ResourceShortage + 0.10×Vulnerability

Match    = 0.30×NeedPriority + 0.25×Proximity + 0.20×QuantityFit
         + 0.15×TimeFit + 0.10×TransportFit
```

Weights must be configurable. Food gets an expiry/deadline boost subject to
safety rules. Final allocation must be **reviewable, explainable, and
overridable** by an authorized operator.

### Example

Input: *"Flooding near Sector 62. Around 300 people are affected. Food and
drinking water are urgently needed."*

Output: flood; critical/high priority; ~300 affected; 300 meals; 600 water units;
nearby sources; volunteer and vehicle requirement; estimated route; coverage;
shortage warnings.

## 12. Roles and permissions

| Role | May |
| --- | --- |
| Admin | Manage users, resources, roles, configuration, oversight |
| Emergency Operator | Create/verify incidents, generate plans, approve allocations, monitor missions |
| NGO / Shelter | Publish capacity and resources, request support |
| Food Donor | Publish surplus food, availability, deadline |
| Volunteer | Publish availability/skills, accept missions, update status |
| Citizen | Submit reports, view permitted status information |

## 13. Screens

Landing · login / role selection · emergency report form with voice · AI incident
analysis · command-centre dashboard · live crisis map · incident detail with
response plan · resource marketplace · food donation form · food-to-need match
results · volunteer mission screen · route and navigation · mission timeline ·
what-if simulator · shortage forecast · impact analytics · admin and audit panel.

## 14. MVP vs advanced

**MVP:** AI crisis analysis, priority scoring, resource database, food surplus
matching, volunteer assignment, basic routes, live dashboard/map, mission
tracking, impact metrics.

**Advanced:** dynamic reallocation, shortage forecasting, what-if simulator,
voice/multilingual, fraud scoring, multi-stop optimization, offline sync,
predictive heatmaps.

## 15. Safety, ethics, reliability

- AI recommendations must not be presented as guaranteed emergency instructions.
- Critical allocations require human approval in the MVP.
- Do not expose private citizen location or contact information unnecessarily.
- Role-based permissions and audit logs.
- Food redistribution follows applicable local food-safety rules.
- Clearly label simulated/demo data.
- Show the reason behind priority and matching scores.
- Provide fallback rules if the AI API fails.

## 16. Demo scenario

Flood incident affecting 300 people → AI parses → critical priority and required
resources → generate response plan → surplus meals from two restaurants and water
from a resource centre → volunteers and vehicles assigned → optimized route →
live mission tracking → **second critical incident** → dynamic reallocation of
uncommitted resources → impact dashboard (meals saved, people helped, response
time, remaining shortage) → optional what-if comparison.

## 17. Differentiation

Not a reporting app, a donation portal, or a volunteer directory — an integrated
decision and execution loop: understand, prioritize, match fragmented resources,
generate missions, optimize logistics, adapt to new incidents, measure impact.

## 18. KPIs

Time from report to approved plan · % needs fulfilled · mission completion time ·
food rescued before expiry · resource utilization · volunteer utilization · people
assisted · predicted vs actual shortage accuracy · % of AI recommendations
accepted or modified by operators.

## 19. Future scope

Integration with official emergency systems and verified NGO networks · IoT and
sensor feeds · satellite/geospatial data · advanced demand forecasting · drone
logistics where legally appropriate · cross-city federation · emergency-management
standards interoperability · mobile app and SMS/low-bandwidth channels.

## 20. Definition of done

PRD implemented · architecture documented · database complete · auth and RBAC
working · responsive frontend · AI working with fallback · priority engine ·
matching with over-allocation prevented · food rescue · maps and routing ·
volunteers · missions · realtime · dynamic reallocation · analytics · security
reviewed · unit + integration + E2E tests passing · demo seed and reset scripts ·
health endpoint · complete documentation · clean GitHub repository · successful
deployment · final demo flow tested end to end.

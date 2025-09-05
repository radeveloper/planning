# Scrum Poker Backend

This project provides a real‑time backend service for the Scrum Poker
planning tool. It is built with [NestJS](https://nestjs.com/),
[Prisma](https://www.prisma.io/) and [PostgreSQL](https://www.postgresql.org/), and
exposes both REST APIs and a WebSocket gateway (Socket.IO) for
interactive room management and voting. The architecture follows
domain‑driven principles and can be extended to support additional
features such as user accounts, third‑party story integrations and
analytics.

## Features

- Guest authentication via JWT tokens (nickname based)
- REST API to create and join rooms
- WebSocket namespace `/poker` for real‑time events
- Prisma schema defining rooms, participants, rounds and votes
- Docker compose configuration for local development (Postgres, Redis, API)

## Getting Started

### Prerequisites

Ensure you have the following installed:

- [Node.js](https://nodejs.org/) (v18 or higher)
- [Docker](https://www.docker.com/) and Docker Compose (optional for local dev)

### Running Locally

Clone the repository and install dependencies:

```bash
cd backend
npm install

# Generate the Prisma client and run migrations
npm run prisma:generate
# If you have Postgres running locally, set DATABASE_URL accordingly and run:
npm run prisma:migrate

# Start the server in development mode
npm run dev
```

The server will start on `http://localhost:3000` and expose the REST API under `http://localhost:3000/api/v1`.

### Using Docker Compose

To start the database, Redis and the API together, run:

```bash
cd backend
docker-compose up --build
```

This will build the API image, run PostgreSQL and Redis and expose the API on port 3000.

### Environment Variables

Create a `.env` file in the root of `backend/` based on `.env.example` and set the appropriate values:

```
DATABASE_URL=postgresql://scrumpoker:scrumpoker@localhost:5432/scrumpoker
JWT_SECRET=supersecretkey
JWT_EXPIRATION=12h
PORT=3000
```

### API Endpoints

#### Authenticate as Guest

`POST /api/v1/auth/guest`

Request body:

```json
{
  "displayName": "Ada"
}
```

Response:

```json
{
  "accessToken": "<JWT>"
}
```

Use the returned access token as a Bearer token in subsequent REST and WebSocket calls.

#### Create Room

`POST /api/v1/rooms` (requires Authorization header)

Body:

```json
{
  "name": "The Agile Architects",
  "deckType": "fibonacci",
  "settings": {}
}
```

Response:

```json
{
  "id": "room-id",
  "code": "ABC123",
  "name": "The Agile Architects",
  "deckType": "fibonacci",
  "participantId": "owner-participant-id"
}
```

#### Join Room

`POST /api/v1/rooms/:code/join`

Body:

```json
{
  "displayName": "Grace"
}
```

#### WebSocket Events

Connect to the `/poker` namespace using Socket.IO and authenticate with your JWT via the `auth.token` option:

```ts
const socket = io('http://localhost:3000/poker', {
  auth: { token: '<JWT>' },
});

socket.emit('join_room', { code: 'ABC123' });
```

The gateway will emit `room_state` events when participants join or leave. Additional events such as `start_voting`, `vote`, `reveal` and `reset` are outlined in the code and can be implemented according to your requirements.

## Next Steps

- Implement full round lifecycle (`start_voting`, `vote`, `reveal`, `reset`)
- Add tests (unit, integration, end‑to‑end) using Jest and Supertest
- Integrate third‑party story imports (Jira, GitHub Issues)
- Add authentication strategies for registered users

---

This project skeleton is intended as a starting point. Feel free to adapt the models, services and gateway to match your organisation’s needs.
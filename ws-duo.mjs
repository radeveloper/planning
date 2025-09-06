// ws-duo.mjs
import { io } from "socket.io-client";

const code = process.env.CODE;
const ownerToken = process.env.TOKEN_OWNER;
const guestToken = process.env.TOKEN_ADA;

const mk = (name, token) => io("http://localhost:3000/poker", {
    auth: { token }, extraHeaders: { Authorization: `Bearer ${token}` }, transports: ["websocket"]
}).on("error", e => console.error(name, "error:", e))
    .on("room_state", s => console.log(name, "room_state:", s.round?.status, s.participants.map(p=>({n:p.displayName,v:p.hasVoted}))));

const owner = mk("OWNER", ownerToken);
const ada = mk("ADA", guestToken);

owner.on("connect", () => {
    owner.emit("join_room", { code }, (ack) => {
        console.log("OWNER join ack:", ack);
        owner.emit("start_voting", {});                 // owner başlatır
        setTimeout(() => ada.emit("join_room", { code }), 200);
        setTimeout(() => ada.emit("vote", { value: "5" }), 500);
        setTimeout(() => owner.emit("reveal", {}), 900);
        setTimeout(() => owner.emit("reset", {}), 1400);
    });
});

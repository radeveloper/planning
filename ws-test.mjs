import { io } from "socket.io-client";

const token = process.env.TOKEN;
const code = process.env.CODE;       // <-- ENV'DEN ALIYORUZ
const participantId = process.env.PID;

console.log("token prefix:", token?.slice(0,16), " code:", code);

const socket = io("http://localhost:3000/poker", {
    auth: { token },
    extraHeaders: { Authorization: `Bearer ${token}` },
    transports: ["websocket"],
});

socket.on("connect", () => {
    console.log("connected", socket.id);

    socket.emit("join_room", { code }, (ack) => {
        console.log("join ack:", ack);
        socket.emit("start_voting", {});           // owner isen çalışır, değilsen error: Only owner...
        setTimeout(() => socket.emit("vote", { value: "5" }), 300); // participantId gerekmez
        setTimeout(() => socket.emit("reveal", {}), 800);
        setTimeout(() => socket.emit("reset", {}), 1400);
    });

});

socket.on("room_state", (s) => console.log("room_state:", s));
socket.on("voting_started", (p) => console.log("voting_started:", p));
socket.on("revealed", (p) => console.log("revealed:", p));
socket.on("reset_done", (p) => console.log("reset_done:", p));
socket.on("error", (e) => console.error("socket error:", e));
socket.on("disconnect", (r) => console.log("disconnected:", r));

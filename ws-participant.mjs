import { io } from "socket.io-client";

const token = process.env.TOKEN;
const code = process.env.CODE;

const socket = io("http://localhost:3000/poker", {
    auth: { token },
    extraHeaders: { Authorization: `Bearer ${token}` },
    transports: ["websocket"],
});

function tryVote() {
    socket.emit("vote", { value: "5" }); // code göndermesek de olur, gateway saklıyor
}

socket.on("connect", () => {
    console.log("participant connected", socket.id);
    socket.emit("join_room", { code }, (ack) => console.log("join ack:", ack));
});

socket.on("room_state", (s) => {
    console.log("room_state:", s.round?.status);
    if (s.round?.status === "voting") tryVote();
});

socket.on("voting_started", () => tryVote());
socket.on("error", (e) => console.error("participant error:", e));

import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const port = process.env.PORT || 3000;

app.use(express.static("public"));

server.listen(port, () => {
  console.log("listening on: " + port);
});

io.on("connection", (socket) => {
  console.log("a user connected:", socket.id);

  socket.on("place", (data) => {
    socket.broadcast.emit("place", data);
  });

  socket.on("disconnect", () => {
    console.log("user disconnected:", socket.id);
  });
});

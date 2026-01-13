const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const QRCode = require("qrcode");

const app = express();
const server = http.createServer(app);

// 🔌 Servidor WS conectado al mismo servidor HTTP
const wss = new WebSocket.Server({ server });

// 📁 Servir archivos del frontend
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// 🧠 Sesiones activas: { code: { pc, mobile } }
let sessions = {};

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 🛜 Conexión WebSocket
wss.on("connection", (ws) => {

  // ⭐ Mantener viva la conexión WS desde el servidor (muy importante)
  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", async (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch {
      return;
    }

    // 🟢 Respuesta al mensaje de keep-alive
    if (data.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
      return;
    }

    // 🖥️ Registrar PC
    if (data.type === "register-pc") {
      const code = generateCode();
      sessions[code] = { pc: ws, mobile: null };

      ws.code = code;
      ws.role = "pc";

      const qrData = `connect:${code}`;
      const qr = await QRCode.toDataURL(qrData);

      ws.send(JSON.stringify({ type: "registered", code, qr }));
      console.log(`💻 PC registrado con código ${code}`);
      return;
    }

    // 📱 Registrar móvil
    if (data.type === "register-mobile") {
      const { code } = data;

      if (sessions[code] && sessions[code].pc && !sessions[code].mobile) {

        sessions[code].mobile = ws;
        ws.code = code;
        ws.role = "mobile";

        sessions[code].pc.send(JSON.stringify({ type: "peer-connected" }));
        ws.send(JSON.stringify({ type: "connected" }));

        console.log(`📱 Móvil conectado a sesión ${code}`);

      } else {
        ws.send(JSON.stringify({
          type: "error",
          message: "Código inválido o ya está en uso en otra sesión."
        }));
      }

      return;
    }

    // 💬 Reenviar mensajes o archivos
    if (data.type === "message" && ws.code) {
      const session = sessions[ws.code];
      if (!session) return;

      const peer = ws.role === "pc" ? session.mobile : session.pc;

      if (peer && peer.readyState === WebSocket.OPEN) {
        peer.send(JSON.stringify({
          type: "message",
          from: ws.role,
          content: data.content || null,
          file: data.file || null,
          filename: data.filename || null
        }));
      }

      return;
    }

       // 🚪 Cerrar sesión sincronizado
    if (data.type === "logout" && ws.code) {
      const session = sessions[ws.code];

      if (session) {

        // Notificar al otro dispositivo
        if (session.pc && session.pc.readyState === WebSocket.OPEN && session.pc !== ws)
          session.pc.send(JSON.stringify({ type: "logout" }));

        if (session.mobile && session.mobile.readyState === WebSocket.OPEN && session.mobile !== ws)
          session.mobile.send(JSON.stringify({ type: "logout" }));

        // ⭐ Esperar un poco para permitir que el mensaje llegue antes de cerrar
        setTimeout(() => {
          if (session.pc && session.pc.readyState === WebSocket.OPEN)
            session.pc.close();

          if (session.mobile && session.mobile.readyState === WebSocket.OPEN)
            session.mobile.close();

          delete sessions[ws.code];
          console.log(`🔒 Sesión ${ws.code} cerrada por ${ws.role}`);
        }, 400);
      }
      return;
    }

  });

  // 🔌 Si un cliente se desconecta abruptamente
  ws.on("close", () => {
    if (ws.code && sessions[ws.code]) {
      const session = sessions[ws.code];

      const peer = ws.role === "pc" ? session.mobile : session.pc;

      if (peer && peer.readyState === WebSocket.OPEN) {
        peer.send(JSON.stringify({ type: "logout" }));
        peer.close();
      }

      delete sessions[ws.code];

      console.log(`❌ Sesión ${ws.code} eliminada tras desconexión de ${ws.role}`);
    }
  });

});

/* 🔥 Mantener activos TODOS los sockets para evitar cierre por inactividad (hosting) */
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      ws.terminate();
      return;
    }

    ws.isAlive = false;
    ws.ping(); // el cliente responde automáticamente con "pong"
  });
}, 15000); // 15 segundos (ideal para hosting)


// 🚀 CONFIGURACIÓN PARA PRODUCCIÓN / HOSTING
const PORT = process.env.PORT || 10000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("🔥 Servidor ejecutándose en el puerto:", PORT);
  console.log("➡ wss://tu-dominio.com");
});
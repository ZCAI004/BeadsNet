# Beads Net (Network Pegboard Demo)

A simple real-time, networked “perler bead / pegboard” wall built with **p5.js + Node.js + Socket.IO**.  
Multiple devices can connect and place colored tiles on a shared grid.

## Features
- 32-color palette (tap to select)
- Real-time sync across clients (WebSockets via Socket.IO)
- Mobile support (touch to place)
- Optional tilt control on iOS (Enable Tilt button)

## Controls
**Desktop**
- Click to place a tile
- Use the left panel to pick a color

**Mobile**
- Tap to place a tile
- Tap **Enable Tilt** (iOS permission required) to move the cursor by tilting the phone

## Run locally
```bash
npm install
node app.js

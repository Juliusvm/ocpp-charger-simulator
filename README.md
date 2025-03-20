
# How to deploy

#### Will be deployed automatically when pushed to main (Azure connected to bitbucket)
https://portal.azure.com/#@mer.eco/resource/subscriptions/9ed59bc3-d4e6-48d9-8959-d5adb0e4d978/resourcegroups/ocpp-charger-simulator/providers/Microsoft.Web/sites/cor-mer-ocpp-charger-simulator/appServices
# How to run


**1.** Start with **npm install**  
**2.** Select the charge point you want

**3.** Start the node server by executing  node remote-charge.js and **leave it running!**  
**4.** Call the endpoint http://localhost:3000/plug with POST method and a body including  
{
"wssUrl": "web-socket-url"
}
**5.** Start a charging session on said charge point using the app or postman    



## Charging Emulator

This **Node.js application** simulates a **charging station** using the **OCPP 1.6 protocol**. It connects to a WebSocket server and emulates the behavior of a real charging station. The app also exposes an **Express.js API** for triggering charging sessions.

---

### Features

1. **WebSocket and Express Setup**
    - **WebSocket Client (`ws`):**  
      Connects to a **WebSocket server** using the OCPP 1.6 protocol to simulate a charging station.
    - **Express Server:**  
      Starts an **Express API** on **port 3000**, exposing endpoints like `/plug` to trigger charging sessions.

2. **Simulating a Charging Session**
   When a POST request is made to **`/plug`**, the script performs the following:

    - **Open WebSocket Connection:**  
      Connects to the provided WebSocket URL to mimic charging station communication.

    - **Send BootNotification:**  
      Sends a **`BootNotification`** to announce the charging station is online.

    - **Handle Backend Responses:**  
      If accepted, sends a **`StatusNotification`** indicating the charger is preparing and waits for a **`RemoteStartTransaction`** command.

    - **Authorize and Start Transaction:**  
      On receiving **RemoteStartTransaction**:
        - Sends an **`Authorize`** request.
        - If authorized, starts the transaction and periodically sends **MeterValues** to simulate energy consumption.

    - **Handle RemoteStopTransaction:**  
      Listens for **`RemoteStopTransaction`** to:
        - Stop sending meter readings.
        - Send **StopTransaction** messages.
        - Reset charger status to **Available**.

3. **Session Management**
    - **`activeSessions` Array:**  
      Tracks multiple charging sessions, storing **WebSocket connections** and **interval IDs** for meter readings.

    - **`clearSession` Function:**  
      Cleans up sessions by:
        - Closing the WebSocket connection.
        - Stopping periodic meter readings.
        - Removing the session from `activeSessions`.

4. **Error Handling and Response Control**
    - Handles errors during **BootNotification**, **Authorize**, or **StartTransaction**.
    - Closes the WebSocket and cleans up the session on failure.
    - Uses **`res.headersSent`** to prevent multiple responses in Express.

5. **API Endpoints**
    - **`GET /`**  
      Returns a welcome message: *"Welcome to Charging Emulator"*.

    - **`POST /plug`**  
      Starts a simulated charging session by connecting to the WebSocket URL provided in the request.

---

### In Summary

- This script is a **Node.js charging station emulator** using **OCPP 1.6**.
- It provides an API to **start simulated charging sessions** and communicates with a **backend system** over WebSockets.
- It manages **session handling**, **WebSocket communication**, and **error handling**, simulating real-world charging processes.
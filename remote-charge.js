const WebSocket = require("ws");
const {v4: uuidv4} = require("uuid");

const chargePoint = process.argv[2];  // Grabs the argument from the command line

const express = require('express');
const app = express();
const port = 3000;

let activeSessions = [];


async function handleBootNotification(message, ws, waitForMessage, latestIdTag, accepted, reject, authorizeRequestId, bootNotificationId, resolve) {
    console.log("Received BootNotification CallResult:", message);

    if (message[2].status === "Accepted") {
        console.log("BootNotification accepted. Sending StatusNotification (Preparing)...");

        const statusNotificationPreparing = [
            2,
            uuidv4(),
            "StatusNotification",
            {
                connectorId: 1,
                status: "Preparing",
                errorCode: "NoError",
            },
        ];
        ws.send(JSON.stringify(statusNotificationPreparing));
        console.log("Sent StatusNotification (Preparing):", statusNotificationPreparing);

        try {
            const remoteStartTransactionMessage = await waitForMessage('RemoteStartTransaction', 30000);
            latestIdTag = remoteStartTransactionMessage[3]?.idTag;
            console.log("Received WebSocket message:", remoteStartTransactionMessage);


            const remoteStartTransactionCallResult = [
                3,
                remoteStartTransactionMessage[1],
                "RemoteStartTransaction",
                {status: "Accepted"},
            ];
            ws.send(JSON.stringify(remoteStartTransactionCallResult));
            console.log("Sent RemoteStartTransaction CallResult:", remoteStartTransactionCallResult);
        } catch (err) {
            console.error("Error waiting for RemoteStartTransaction:", err);
            accepted = false;
            ws.close();
            reject(err);
        }

        console.log("RemoteStartTransaction accepted. Sending Authorize...");
        authorizeRequestId = uuidv4();
        const authorizeRequest = [
            2,
            authorizeRequestId,
            "Authorize",
            {idTag: latestIdTag},
        ];
        ws.send(JSON.stringify(authorizeRequest));
        console.log("Sent Authorize:", authorizeRequest);
    } else {
        console.warn(`BootNotification not accepted: ${message[2].status}`);
        clearInterval(bootNotificationId);
        accepted = false;

        resolve();
    }
    return {latestIdTag, accepted, authorizeRequestId};
}

function handleAuthorizationCallResult(message, startTransactionId, latestIdTag, meterReading, ws, accepted, resolve) {
    console.log("Received Authorize CallResult:", message);

    if (message[2].idTagInfo.status === "Accepted") {
        console.log("Authorize accepted. Sending StartTransaction...");

        startTransactionId = uuidv4();
        const startTransactionRequest = [
            2,
            startTransactionId,
            "StartTransaction",
            {
                connectorId: 1,
                idTag: latestIdTag,
                meterStart: meterReading,
                timestamp: new Date().toISOString(),
            },
        ];
        ws.send(JSON.stringify(startTransactionRequest));
        console.log("Sent StartTransaction:", startTransactionRequest);
    } else {
        console.warn(`Authorize not accepted: ${message[2].idTagInfo.status}`);
        accepted = false;
        ws.close();
        resolve();
    }
    return {startTransactionId, accepted};
}

const simulateHybridRemoteCharger = async ({res, bootNotificationId, targetPower, ws}) => {
    return new Promise((resolve, reject) => {
        let meterReading = 0;
        let transactionId;
        let stopTransactionId;


        let authorizeRequestId;
        let startTransactionId;
        let latestIdTag;

        const waitForMessage = (expectedMessageType, timeout) => {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new Error(`Timeout waiting for message: ${expectedMessageType}`));
                }, timeout);

                ws.on("message", (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        if (message[2] === expectedMessageType) {
                            clearTimeout(timer);
                            resolve(message);
                        }
                    } catch (err) {
                        reject(err);
                    }
                });
            });
        };

        ws.on("open", () => {
            console.log("WebSocket connection opened");

            const bootNotification = [
                2,
                bootNotificationId,
                "BootNotification",
                {
                    chargePointVendor: "EVA",
                    chargePointModel: "Model-1",
                },
            ];
            ws.send(JSON.stringify(bootNotification));
            console.log("Sent BootNotification:", bootNotification);
        });

        ws.on("message", async (data) => {
            try {
                const message = JSON.parse(data.toString());
                let accepted = true;

                if (message[0] === 3 && message[1] === bootNotificationId) {
                    const bootNotificationResponse = await handleBootNotification(message, ws, waitForMessage, latestIdTag, accepted, reject, authorizeRequestId, bootNotificationId, resolve);
                    latestIdTag = bootNotificationResponse.latestIdTag;
                    accepted = bootNotificationResponse.accepted;
                    authorizeRequestId = bootNotificationResponse.authorizeRequestId;
                }

                if (message[0] === 3 && message[1] === authorizeRequestId) {
                    const authorizationCallResult = handleAuthorizationCallResult(message, startTransactionId, latestIdTag, meterReading, ws, accepted, resolve);
                    startTransactionId = authorizationCallResult.startTransactionId;
                    accepted = authorizationCallResult.accepted;
                }

                if (!res.headersSent) res.status(accepted ? 200 : 400).json({ message: accepted ? "Plugged!" : 'Error' });


                if (message[0] === 3 && message[1] === startTransactionId) {
                    console.log("Received StartTransaction CallResult:", message);
                    transactionId = message[2].transactionId;


                    /// Start sending meter values
                    const intervalId = setInterval(() => {
                        meterReading += targetPower / 12;
                        console.log("Simulated Meter Reading:", meterReading.toFixed(2), "Wh");

                        const meterValueRequest = [
                            2,
                            uuidv4(),
                            "MeterValues",
                            {
                                connectorId: 1,
                                meterValue: [
                                    {
                                        timestamp: new Date().toISOString(),
                                        sampledValue: [
                                            {
                                                value: meterReading.toString(),
                                                context: "Sample.Periodic",
                                                format: "Raw",
                                                measurand: "Energy.Active.Import.Register",
                                                location: "Outlet",
                                                unit: "Wh",
                                            },
                                        ],
                                    },
                                ],
                                transactionId: transactionId,
                            },
                        ];
                        ws.send(JSON.stringify(meterValueRequest));
                        console.log("Sent MeterValues:", meterValueRequest);
                    }, 5000);


                    activeSessions = activeSessions.map((s) => {
                        if (s.bootNotificationId === bootNotificationId) {
                            return {...s, intervalId: intervalId}
                        }
                        return s;
                    });

                    // Handle RemoteStopTransaction
                    ws.on("message", async (data) => {
                        try {
                            const stopMessage = JSON.parse(data.toString());

                            if (stopMessage[2] === "RemoteStopTransaction") {
                                console.log("Received RemoteStopTransaction:", stopMessage);

                                // Respond to RemoteStopTransaction
                                const remoteStopTransactionCallResult = [
                                    3,
                                    stopMessage[1],
                                    "RemoteStopTransaction",
                                    {status: "Accepted"},
                                ];
                                ws.send(JSON.stringify(remoteStopTransactionCallResult));
                                console.log("Sent RemoteStopTransaction CallResult:", remoteStopTransactionCallResult);

                                if (transactionId) {
                                    stopTransactionId = uuidv4();
                                    const stopTransactionRequest = [
                                        2,
                                        stopTransactionId,
                                        "StopTransaction",
                                        {
                                            transactionId: transactionId,
                                            meterStop: Math.floor(meterReading),
                                            timestamp: new Date().toISOString(),
                                            reason: "Remote",
                                            idTag: latestIdTag,
                                            transactionData: [
                                                {
                                                    timestamp: new Date().toISOString(),
                                                    sampledValue: [
                                                        {
                                                            value: Math.floor(meterReading).toString(),
                                                            context: "Transaction.End",
                                                            format: "Raw",
                                                            measurand: "Energy.Active.Import.Register",
                                                            location: "Outlet",
                                                            unit: "Wh",
                                                        },
                                                    ],
                                                },
                                            ],
                                        },
                                    ];
                                    ws.send(JSON.stringify(stopTransactionRequest));
                                    console.log("Sent StopTransaction:", stopTransactionRequest);
                                }

                                // Send StatusNotification with "Finishing" status
                                const statusNotificationFinishing = [
                                    2,
                                    uuidv4(),
                                    "StatusNotification",
                                    {
                                        connectorId: 1,
                                        status: "Finishing",
                                        errorCode: "NoError",
                                    },
                                ];
                                ws.send(JSON.stringify(statusNotificationFinishing));
                                console.log("Sent StatusNotification (Finishing):", statusNotificationFinishing);

                                // Send StatusNotification with "Available" status
                                const statusNotificationAvailable = [
                                    2,
                                    uuidv4(),
                                    "StatusNotification",
                                    {
                                        connectorId: 1,
                                        status: "Available",
                                        errorCode: "NoError",
                                    },
                                ];
                                ws.send(JSON.stringify(statusNotificationAvailable));
                                console.log("Sent StatusNotification (Available):", statusNotificationAvailable);

                                ws.close();
                                resolve();
                            }
                        } catch (err) {
                            reject(err);
                        }
                    });
                }
            } catch (err) {
                reject(err);
                res.status(400).json({message: err});
            }
        });
    });
};


app.use(express.json());

app.get('/', (req, res) => {
    res.send('Welcome to Charging Emulator');
});

function clearSession(bootNotificationId) {
    const session = activeSessions.find((s) => s.bootNotificationId === bootNotificationId);
    session.ws.close();
    clearInterval(session.intervalId);
    activeSessions = activeSessions.filter((s) => s.bootNotificationId !== bootNotificationId);
}

// Used to plug
app.post('/plug', async (req, res) => {
    const receivedData = req.body;
    if (!receivedData.wssUrl) {
        console.error("Error: No chargePoint provided. Please run the script as: node remote-charge.js <chargePoint>");
        res.json({message: 'No charge point provided'});
    }


    const ws = new WebSocket(receivedData.wssUrl, "ocpp1.6");
    const bootNotificationId = uuidv4();
    activeSessions.push({
        bootNotificationId: bootNotificationId,
        ws: ws,
    });

    simulateHybridRemoteCharger({
        res: res,
        bootNotificationId: bootNotificationId,
        targetPower: 300,
        ws: ws
    }).then(() => {
        console.log("Simulation completed successfully.");
        setTimeout(() => {
                clearSession(bootNotificationId);
            },
            /// After 15 seconds. we close the socket and stop sending meter values
            15000);
    }).catch((err) => {
        console.error("Simulation failed:", err);
        setTimeout(() => {
            clearSession(bootNotificationId);
        }, 10000);
    });

});

// Start the server
app.listen(port, () => {
    console.log(`API is running at http://localhost:${port}`);
});
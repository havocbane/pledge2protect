const express = require('express');
const path = require('path');
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;
const bodyParser = require('body-parser');
const { Parser } = require('json2csv');

const {
    getCountUserPledges,
    savePledge,
    saveDependent,
    saveDestination,
    addEmailSubscriber,
    createParty,
} = require('./user');

const {
  audienceExport,
} = require('./reports');

const isDev = process.env.NODE_ENV !== 'production';
const PORT = process.env.PORT || 5000;

const isPayloadValid = (payload) => {
    const requiredFields = [
        'emailAddress',
        'firstName',
        'lastName',
        'phoneNumber',
        'state',
        'zipCode',
        'acceptPrivacyPolicy',
        'preRequirement',
    ];

    if (!payload) {
        return false;
    }

    const hasMissingFields = requiredFields.reduce((accumulator, field) => {
        return (accumulator === true && payload[field]);
    }, true);
    if (hasMissingFields) {
        return false;
    }

    if (!['maineQuarantined', 'quarantined', 'origin', 'tested'].includes(payload.preRequirement)) {
        return false;
    }

    if (payload['dependentAge-0'] !== undefined && payload['dependentsCertification'] !== true) {
        return false;
    }

    return true;
};

const getParameterGroups = (payload, parameters) => {
    const output = [];
    let checkIndex = 0;
    while (true) {
        const firstKey = `${parameters[0]}-${checkIndex}`;
        if (payload[firstKey] === undefined) {
            return output;
        }
        output.push([]);
        parameters.forEach((parameter) => {
            const key = `${parameter}-${checkIndex}`;
            output[checkIndex].push(payload[key]);
        });
        checkIndex++;
    }
};

function runServer() {
    const app = express();
    const basicAuth = require('express-basic-auth')

    // Priority serve any static files.
    app.use(express.static(path.resolve(__dirname, '../react-ui/build')));
    app.use(bodyParser.json()); // for parsing application/json
    app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

    app.get('/pledge/count', (req, res) => {
        res.set('Content-Type', 'application/json');

        getCountUserPledges((error, pledgeCount) => {
            if (error) {
                res.status(500)
                    .send({ error: true, message: error });
                return;
            }

            res.send(pledgeCount);
        });
    });

    const basicAuthPassword = process.env.BASIC_AUTH_PASS || Math.random().toString(36).substring(2);
    const fields = [
      'first_name',
      'last_name',
      'destination_email',
      'arrival_date',
      'phone_number',
      'dependents',
      'party_members',
      'email_address',
    ];
    const opts = { fields };
    app.get('/reports/audience', basicAuth(
      {
        users: { 'admin': basicAuthPassword },
        challenge: true,
        realm: 'thepeoplematter'
      }), (req, res) => {
        res.set('Content-Type', 'text/csv');
        audienceExport((error, results) => {
          if (error) {
            res.status(500).send({ error: true, message: error });
            return;
          }
          const dateStr = new Date().toISOString().split('T')[0];
          const fileName = 'audience_report_' + dateStr + '.csv';
          res.attachment(fileName);

          const parser = new Parser(opts);
          const csv = parser.parse(results);
          res.send(csv);
        });
      });

    app.post('/pledge', async (req, res) => {
        const payload = req.body;

        // validate the user data
        if (!isPayloadValid(payload)) {
            res.status(400)
                .send({ error: true, message: 'Please provide all required fields' });
            return;
        }

        const members = getParameterGroups(payload, ['memberFirstName', 'memberLastName', 'memberEmail']);
        const dependents = getParameterGroups(payload, ['dependentRelationship', 'dependentAge']);
        const destinations = getParameterGroups(payload, ['destinationEmail', 'arrivalDate']);

        const subscribeResults = {
            main: undefined,
            destination: [],
            party: [],
        };

        if (process.env.ENABLE_EMAIL_SUBSCRIPTION === 'true') {
            const mainUser = {
                emailAddress: payload.emailAddress,
                firstName: payload.firstName,
                lastName: payload.lastName,
                state: payload.state,
                zipCode: payload.zipCode,
                phoneNumber: payload.phoneNumber,
                mainePhoneNumber: payload.mainePhoneNumber,
                isHost: true,
                hasPledged: true,
            };
            const destinationUsers = destinations.map((destination) => (
                {
                    emailAddress: destination[0].trim(),
                }
            ));
            const partyUsers = members.map((member) => (
                {
                    emailAddress: member[2],
                    firstName: member[0],
                    lastName: member[1],
                    isHost: false,
                    hasPledged: false,
                }
            ));

            try {
                const result = await addEmailSubscriber(mainUser);
                subscribeResults.main = result.id;

                // eslint-disable-next-line
                const destinationPromises = destinationUsers.map(async (destination) => {
                    const destResult = await addEmailSubscriber(destination, 'destination');
                    subscribeResults.destination.push(destResult.id);
                });

                // eslint-disable-next-line
                const partyPromises = partyUsers.map(async (member) => {
                    const partyResult = await addEmailSubscriber(member, 'party');
                    subscribeResults.party.push(partyResult.id);
                });
            } catch (error) {
                console.error(error);
                const errorResponse = { error: true, message: error.message };
                if (error.code) {
                    errorResponse.code = error.code;
                }
                res.status(500)
                    .send(errorResponse);
                return;
            }
        }

        createParty()
            .then((partyId) => {
                const promises = [];

                const mainPayload = {
                    emailAddress: payload.emailAddress,
                    firstName: payload.firstName,
                    lastName: payload.lastName,
                    zipCode: payload.zipCode,
                    state: payload.state,
                    phoneNumber: payload.phoneNumber,
                    mainePhoneNumber: payload.mainePhoneNumber,
                    isHost: true,
                    hasPledged: true,
                    subscribedEmailId: subscribeResults.main,
                    partyId,
                };
                promises.push(savePledge(mainPayload));

                members.forEach(([firstName, lastName, email]) => {
                    const memberPayload = {
                        emailAddress: email,
                        firstName,
                        lastName,
                        isHost: false,
                        hasPledged: false,
                        partyId,
                    };
                    const promise = savePledge(memberPayload);
                    promises.push(promise);
                });

                dependents.forEach(([relationship, age]) => {
                    const dependentPayload = {
                        relationship,
                        age,
                        partyId,
                    };
                    const promise = saveDependent(dependentPayload);
                    promises.push(promise);
                });

                destinations.forEach(([destinationEmail, arrivalDate]) => {
                    const destinationPayload = {
                        emailAddress: destinationEmail,
                        arrivalDate,
                        partyId,
                    };
                    const promise = saveDestination(destinationPayload);
                    promises.push(promise);
                });

                Promise.all(promises)
                    .then(() => {
                        res.send('success');
                    })
                    .catch((err) => {
                        res.status(500).send({ error: true, message: err });
                    });

            })
            .catch((err) => {
                console.log(err);
                res.status(500).send({ error: true, message: 'Failed to create party' });
            });

    });

    // All remaining requests return the React app, so it can handle routing.
    app.get('*', (request, response) => {
        response.sendFile(path.resolve(__dirname, '../react-ui/build', 'index.html'));
    });

    app.listen(PORT, () => {
        console.error(`Node ${isDev ? 'dev server' : `cluster worker ${process.pid}`}: listening on port ${PORT}`);
    });
}

// Multi-process to utilize all CPU cores.
if (!isDev && cluster.isMaster) {
    console.error(`Node cluster master ${process.pid} is running`);

    // Fork workers.
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        console.error(`Node cluster worker ${worker.process.pid} exited: code ${code}, signal ${signal}`);
    });
} else {
    runServer();
}

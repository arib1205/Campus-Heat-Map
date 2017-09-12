/*
 * Server.js
 * 
 * The main portion of this project. Contains all the defined routes for express,
 * rules for the websockets, and rules for the MQTT broker.
 * 
 * Refer to the portions surrounded by --- for points of interest
 */
var express   = require('express'),
	app       = express();
var engines = require('consolidate');


var bodyParser = require('body-parser');
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());

var pug       = require('pug');
var sockets   = require('socket.io');
var path      = require('path');

var conf      = require(path.join(__dirname, 'config'));
var internals = require(path.join(__dirname, 'internals'));

var clientMap = new Map();
var THRESHOLD = 5;

var beaconCount = {
	beacon1 : 0,
	beacon2 : 0,
	beacon3 : 0,
	beacon4 : 0
 };
	
var padding = "-------------------------------------------------------------------------";
var restSocket;

// -- Setup the application
setupExpress();
setupSocket();

function updateCount(data, client){
	//console.log(JSON.stringify(data));
	var id = getIdFromPayload(data);
	updateCountByClientId(id);
}

function getIdFromPayload(data){
	var clientIdBuffer = data.payload;
	var id = "";
	for(var i = 0 ; i < clientIdBuffer.length - 1 && i < 4 ; i++){ 
		id = id + String.fromCharCode(clientIdBuffer[i]); 
	}
	id = Number(id);
	return id;
}

function getDeviceCountFromPayload(data){
	var id = getIdFromPayload(data);
	return clientMap.get(id);
}

function updateCountByClientId(id){
	/
	if(clientMap.get(id) != void 0){
		var deviceCount = clientMap.get(id);
		if(deviceCount + 1 > THRESHOLD){
			fireThresholdExeceededEvent(id);
		}
		deviceCount++;
		clientMap.set(id, deviceCount);
		console.log(clientMap);
	}
	console.log(padding);
}


function addClient(client) {
	var id = client.id;
	id = Number(id);
		
	if(!clientMap.get(id)){
		clientMap.set(id, 0);
		console.log('Added new client to the map : ' + id);
		console.log(clientMap);
		console.log(padding);
	}
}

function removeClient(client){
	var id = client.id;
	id = Number(id);
		
	clientMap.delete(id);
	console.log('Client Disconnected. Removed client : ' + id + ' from the map');
	console.log(padding);
}

function getDeviceCount(){
	clientMap.forEach(function(value, key){
		
		switch(key){ 
			case 1234 : beaconCount.beacon1 = value / 5; break;
			case 4321 : beaconCount.beacon2 = value / 5; break;
			case 6789 : beaconCount.beacon3 = value / 5; break;
			case 9876 : beaconCount.beacon4 = value / 5; break;
		}
		
	});
	console.log(JSON.stringify(beaconCount));
	return beaconCount;
}

function fireThresholdExeceededEvent(clientId){
 	internals.publish('ufheatmap', 'glow' + clientId);
}

// -- Socket Handler
// Here is where you should handle socket/mqtt events
// The mqtt object should allow you to interface with the MQTT broker through 
// events. Refer to the documentation for more info 
// -> https://github.com/mcollina/mosca/wiki/Mosca-basic-usage
// ----------------------------------------------------------------------------
function socket_handler(socket, mqtt) {

	socket.on('updateCount' , function(){
		socket.emit('values' , getDeviceCount());
	});

	// Called when a client connects
	mqtt.on('clientConnected', client => {
		addClient(client);
		socket.emit('debug', {
			type: 'CLIENT', msg: 'New client connected: ' + client.id
		});

		socket.emit('values' , getDeviceCount());
	});

	// Called when a client disconnects
	mqtt.on('clientDisconnected', client => {
		removeClient(client);
		socket.emit('debug', {
			type: 'CLIENT', msg: 'Client "' + client.id + '" has disconnected'
		});

		socket.emit('values' , getDeviceCount());
	});

	// Called when a client publishes data
	mqtt.on('published', (data, client) => {

		if (!client){
			return;
		}

		updateCount(data,client);
		var deviceCount = getDeviceCountFromPayload(data);
		socket.emit('debug', {
			type: 'PUBLISH', 
			msg: 'Client "' + client.id + '" published "' + JSON.stringify(data) + '"' + " No of devices : " + deviceCount
		});

		socket.emit('values' , getDeviceCount());
		
	});

	// Called when a client subscribes
	mqtt.on('subscribed', (topic, client) => {
		if (!client) return;
		//console.log('Subscribed !!!!!!!!!');
		socket.emit('debug', {
			type: 'SUBSCRIBE',
			msg: 'Client "' + client.id + '" subscribed to "' + topic + '"'
		});
	});

	// Called when a client unsubscribes
	mqtt.on('unsubscribed', (topic, client) => {
		if (!client) return;

		socket.emit('debug', {
			type: 'SUBSCRIBE',
			msg: 'Client "' + client.id + '" unsubscribed from "' + topic + '"'
		});
	});
}
// ----------------------------------------------------------------------------


// Helper functions
function setupExpress() {
	//app.set('view engine', 'pug'); // Set express to use pug for rendering HTML

	// Setup the 'public' folder to be statically accessable
	var publicDir = path.join(__dirname, 'public');
	app.use(express.static(publicDir));
	app.set('views', __dirname + '/views');
	app.engine('html', engines.mustache);
	app.set('view engine', 'html');

	var jsonParser = bodyParser.json({ type: 'application/*+json'});

	
	// Setup the paths (Insert any other needed paths here)
	// ------------------------------------------------------------------------
	// Home page
	app.get('/', (req, res) => {
		res.render('index', {title: 'MQTT Tracker'});
	});

	app.post('/device', jsonParser, function(req, res) {
		console.log("POST | Name : " + req.body.name + 
			" | UUID : " + req.body.uuid + 
			" | MAC : " + req.body.address +
			" | MBED-ID : " + req.body.mbedid);
		var beaconName = req.body.name;
		var beaconUUID = req.body.uuid;
		var beaconMac = req.body.address;
		var mbedBoardId = req.body.mbedid;

		mbedBoardId = Number(mbedBoardId);
		updateCountByClientId(mbedBoardId);
		restSocket.emit('values' , getDeviceCount());

		res.status(200).send("SUCCESS");
	});

	// Basic 404 Page
	app.use((req, res, next) => {
		var err = {
			stack: {},
			status: 404,
			message: "Error 404: Page Not Found '" + req.path + "'"
		};

		// Pass the error to the error handler below
		next(err);
	});

	// Error handler
	app.use((err, req, res, next) => {
		console.log("Error found: ", err);
		res.status(err.status || 500);

		res.render('error', {title: 'Error', error: err.message});
	});
	// ------------------------------------------------------------------------

	// Handle killing the server
	process.on('SIGINT', () => {
		internals.stop();
		process.kill(process.pid);
	});
}

function setupSocket() {
	
	var server = require('http').createServer(app);
	var io = sockets(server);
	
	// Setup the internals
	internals.start(mqtt => {
		io.on('connection', socket => {
					socket_handler(socket, mqtt);
					restSocket = socket;
		});
	});

	server.listen(conf.PORT, conf.HOST, () => { 
		console.log("Listening on: " + conf.HOST + ":" + conf.PORT);
	});
}
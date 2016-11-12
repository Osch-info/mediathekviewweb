const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const moment = require('moment');
const SearchEngine = require('./SearchEngine.js');
const MediathekIndexer = require('./MediathekIndexer.js');
const Hjson = require('hjson');

const config = Hjson.parse(fs.readFileSync('config.hjson', 'utf8'));
console.log(config);
//process.exit(0);

var app = express();
var httpServer = http.Server(app);
var io = require('socket.io')(httpServer);
var searchEngine = new SearchEngine();
var mediathekIndexer = new MediathekIndexer(config.redis.host, config.redis.port, config.redis.password, config.redis.db1, config.redis.db2);

mediathekIndexer.indexFile('../fulldata', config.min_word_size);

var workerStates = [];

mediathekIndexer.on('workerState', (workerIndex, state) => {
    workerStates[workerIndex] = state;
    logWorkerStates();
});

function logWorkerStates() {
    for (var i = 0; i < workerStates.length; i++) {
        let state = workerStates[i];

        if (state == null) continue;

        let num = i + 1;

        console.log('worker ' + num + ': ');
        console.log('\tprogress: ' + (state.progress * 100).toFixed(2) + '%');
        console.log('\tentries: ' + state.entries);
        console.log('\tindices: ' + state.indices);
        console.log('\ttime: ' + (state.time / 1000) + ' seconds');
    }
}

app.use('/static', express.static('static'));

app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname + '/index.html'));
});

io.on('connection', (socket) => {
    socket.on('queryEntry', (query) => {
        queryEntries(query, 'and', (result) => {
            socket.emit('queryResult', result);
        });
    });
});

httpServer.listen(8080, () => {
    console.log('server listening on *:8080');
});

function queryEntries(query, mode, callback) {
    console.log('querying ' + query);
    let begin = Date.now();

    searchEngine.search(query, config.min_word_size, mode, (result, err) => {
        if (err) {
            console.log(err);
            callback([]);
            return;
        }

        let searchEngineTime = Date.now() - begin;
        begin = Date.now();
        let resultCount = result.length;

        result = result.sort((a, b) => {
            let relevanceDiff = b.relevance - a.relevance;
            if (relevanceDiff == 0) {
                let aMoment = moment.unix(a.data.timestamp);
                let bMoment = moment.unix(b.data.timestamp);

                if (aMoment.isSameOrAfter(bMoment))
                    return -1;
                else
                    return 1;
            } else {
                return relevanceDiff;
            }
        }).slice(0, 50);

        let filterTime = Date.now() - begin;
        let queryInfo = {
            searchEngineTime: searchEngineTime,
            filterTime: filterTime,
            resultCount: resultCount
        };

        callback({
            data: result,
            queryInfo: queryInfo
        });

        console.log('query took ' + (Date.now() - begin) / 1000 + ' seconds');

    });
}
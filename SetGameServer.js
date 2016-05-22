/* Set Game Server
 J. Femister
 Version 1.0 11/13/13 - Original Non-Hardened Version
 Version 1.1 11/13/13 - Code added to handle input errors 
 Version 1.2 11/20/13 - 
 a) Modified login code: Logging in more than once with the same name returns
 the same id. All login names are filtered for [A-Za-z0-9 ].
 b) Modified processSubmitSet function to verify that the submitted object is 
 an array of three numbers.
 c) Modified processAddRow, processShuffle and processEndGame so that each requires
 a majority vote of the players. All the flags are reset when the action is taken.
 Version 1.3 11/21/13 - 
 a) Added checks for card values in range (1..81) and != each other and in hand to processSubmitSet.
 Version 1.4 4/9/15 - Made numerous changes to accomodate ajax calls directly from the
 browser and to accomodate jsonp.
 Version 1.5 4/10/15 - Added numerous comments and chat function.
 Version 1.6 4/30/15 - Did some refactoring. Streamlined the log messages and included
 logging of client ip addresses.
 */

// Constants

var PORT = 3000;
var DEBUG = 1;
var NOT_BEING_USED = -1;
var ERROR = -1;
var SUCCESS = 0;

// Utility Functions

/*
 * Shuffle randomizes the elements in array a.
 */
function shuffle(a) {
    for (var i = 0; i < a.length; ++i) {
        var n = Math.floor(Math.random() * a.length);
        var tmp = a[n];
        a[n] = a[0];
        a[0] = tmp;
    }
}

/*
 * Header adds a Content-Type header to the response indicating that all output
 * will be json formatted.
 */
function header(res) {
    res.writeHead(200, {
        'Content-Type': 'application/json'
    });
}

/* 
 * Wrap is a utility function for implementing jsonp, a method (basically hack)
 * for doing cross-domain calls. 
 * See: http://en.wikipedia.org/wiki/JSONP
 * See: http://en.wikipedia.org/wiki/Cross-origin_resource_sharing
 */
function wrap(txt, callb) {
    return callb + "(" + txt + ")";
}

function errorLog(fcn, ctx, e) {
    console.log(fcn + ': Error on input (' + ctx + ') ' + e.toString());
}

function log(ipaddr, id, message) {
    console.log(ipaddr + "(" + id + "): " + message);
}

/*
 * Class: Deck
 * Description: A Deck object contains one or more complete decks of Set cards.
 */

// Constructor
var Deck = function (ndecks) {
    var a = new Array();
    for (var i = 0; i < 81; ++i) {
        a[i] = i + 1;
    }
    shuffle(a);
    this.cards = a;
    this.nextCard = 0;
};

// Deal a single card or return 0 if the deck has run out.
Deck.prototype.getCard = function () {
    if (this.nextCard < 81)
        return this.cards[this.nextCard++];
    else
        return 0;
}

var numberOfDecks = 1;
var setDeck = new Deck(numberOfDecks);

/*
 * Class: Hand
 * Description: The Hand object contains all the cards in the grid. The server 
 *   maintains a single hand of cards which it repeatedly broadcasts to the players
 *   as it changes.
 */

// Constructor
var Hand = function () {
    this.cards = [];
};

// Initialize the Hand with 12 cards from the Deck.
Hand.prototype.init = function () {
    var hand = new Array();
    for (var i = 0; i < 12; ++i) {
        hand[i] = setDeck.getCard();
    }
    this.cards = hand;
};

// Add a new Card to the end of the Hand.
Hand.prototype.addCard = function (c) {
    this.cards.push(c);
};

// Remove the given Card from the Hand.
Hand.prototype.removeCard = function (c) {
    var index = this.cards.indexOf(c);
    if (index != -1)
        this.cards.splice(index, 1);
};

// Shuffle the cards in the Hand.
Hand.prototype.shuffleCards = function () {
    shuffle(this.cards);
    console.log("Cards Shuffled");
};

// Check to see if a given card is in the Hand.
Hand.prototype.inHand = function (card) {
    return this.cards.indexOf(card) != -1;
};

/*
 * Class: Player
 * Description: Contains all the information maintained about a single player. 
 *   The server maintains an array of players which is broadcast to the clients
 *   whenever it changes.
 */

// Constructor
var Player = function (login) {
    this.player = login;
    this.score = 0;
    this.row = false;
    this.shuffle = false;
    this.end = false;
    this.winner = false;
}

/*
 * Class: PlayerList
 * Description: Contains the list of players currently playing the game with 
 *   methods for querying and manipulating it.
 */

// Constructor
var PlayerList = function () {
    this.players = new Array();
};

// Increase a given player's score for having submitted a set.
PlayerList.prototype.updateScore = function (id) {
    this.players[id - 1].score += 3;
};

// Add a new Player to the end of the PlayerList.
PlayerList.prototype.add = function (player) {
    this.players.push(player);
};

// Returns the number of players.
PlayerList.prototype.length = function () {
    return this.players.length;
};

// Check to see if a given player is on the PlayerList.
PlayerList.prototype.onList = function (id) {
    return id > 0 && id <= this.players.length;
}

// Returns the id of a Player with a given login name else 0.
PlayerList.prototype.getId = function (name) {
    for (var i = 0; i < this.players.length; ++i) {
        if (this.players[i].player === name) {
            return i + 1;
        }
    }
    return 0;
};

// Returns the player object of a Player with a given id else null.
PlayerList.prototype.getPlayer = function (id) {
    var index = id - 1;
    if (index < 0 || index >= this.players.length) {
        return null;
    } else {
        return this.players[index];
    }
};

// Checks to see if at least half the players have voted
PlayerList.prototype.isVoteOk = function (field) {
    var vote = 0;
    this.players.forEach(function (elem, index, obj) {
        if (elem[field])
            ++vote;
    });
    return vote * 2 >= this.players.length;
};

// Resets the votes for all players.
PlayerList.prototype.resetVote = function (field) {
    this.players.forEach(function (elem, index, obj) {
        elem[field] = false;
    });
};

// Sets the winner flag for the player with the highest score and resets all
// the others.
PlayerList.prototype.setWinner = function () {
    var hi = -1;
    var winner = -1;
    for (var i = 0; i < this.players.length; ++i) {
        if (this.players[i].score > hi) {
            hi = this.players[i].score;
            winner = i;
        }
    }
    if (winner > -1) {
        for (var j = 0; j < this.players.length; ++j) {
            if (j === winner)
                this.players[j].winner = true;
            else
                this.players[j].winner = false;
        }
    }
    console.log("Winner Set");
};

var url = require('url');
var setHand = new Hand();
setHand.init();
var setPlayers = new PlayerList();

/*
 * Services
 * process* are the services that the clients can request
 */


/*
 * Function: processLogin
 * Description: Processes a login request from the client. Filters out empty 
 *   login names and removes special characters from names. If the login name 
 *   hasn't been used before, then a new integer id is assigned and returned or 
 *   else the old id is returned. Therefore, if a user logs in repeatedly with 
 *   the same login name they will keep receiving the same id.
 */
function processLogin(req, res) {
    var body = '';

    req.on('data', function (chunk) {
        body += chunk;
    });

    req.on('end', function () {
        header(res);

        var name = "";
        try {
            var ipaddr = req.connection.remoteAddress;
            var query = url.parse(req.url, true).query;
            var callback = query.callback;
            name = query.loginName;
            filteredName = name.replace(/[^a-zA-Z0-9 ]/g, "");
            if (filteredName.length <= 0) {
                log(ipaddr, 0, 'Login: Empty name rejected. (' + name + ")");
                var tmp = wrap(JSON.stringify(-1), callback);
                res.end(tmp);
            } else {
                var id = setPlayers.getId(filteredName);
                if (id > 0) {
                    log(ipaddr, id, 'Login: Relogin (' + filteredName + ')');
                    var tmp = wrap(JSON.stringify(id), callback);
                    res.end(tmp);
                } else {
                    setPlayers.add(new Player(filteredName));
                    var index = setPlayers.length();
                    log(ipaddr, index, 'Login: New login (' + filteredName + ')');
                    var tmp = wrap(JSON.stringify(index), callback);
                    clientList[ipaddr] = index;
                    res.end(tmp);
                }
            }
            updateHand();
            updateStatus();
        } catch (e) {
            errorLog('processLogin error', body, e);
            var tmp = wrap(JSON.stringify(-1), callback);
            res.end(tmp);
        }

    });
}

// Utility method for adding 3 new cards to the hand either to: 1) replace a 
//   submitted set or 2) add a new row.
function addCards() {
    for (var i = 0; i < 3; ++i) {
        var card = setDeck.getCard();
        if (card > 0)
            setHand.addCard(card);
    }
}

/* 
 * Function: processSubmitSet
 * Description: Processes a submit set request from the client. It receives 3
 *   cards from the client and does the following:
 *   1) Performs some validity checks on the list (eg. numbers, not strings)
 *   2) Checks if the cards constitute a valid set and rejects if not.
 *   3) Removes the cards from the hand.
 *   4) Updates the player's score.
 *   5) Returns true if a valid set, false otherwise. 
 */
function processSubmitSet(req, res) {


    function isSet(ilist, hand) {

        function isTypeOk(obj) {
            if (!(obj instanceof Array))
                return false;
            else if (obj.length != 3)
                return false;
            else if (typeof obj[0] != "number" || typeof obj[1] != "number" || typeof obj[2] != "number")
                return false;
            else
                return true;
        }

        function numbersOk(list) {
            return list[0] >= 1 && list[0] <= 81 &&
                    list[1] >= 1 && list[1] <= 81 &&
                    list[2] >= 1 && list[2] <= 81 &&
                    list[0] != list[1] && list[1] != list[2] && list[0] != list[2];
        }

        function cardsInHand() {
            return hand.inHand(ilist[0]) && hand.inHand(ilist[1]) && hand.inHand(ilist[2])
        }

        function count(n) {
            return (n - 1) % 3 + 1;
        }
        function color(n) { // 1=red 2=purple 3=green
            return (Math.ceil(n / 3) - 1) % 3 + 1;
        }
        function shape(n) { // 1=squiggle 2=diamond 3=oval
            return (Math.ceil(n / 9) - 1) % 3 + 1;
        }
        function fill(n) { // 1=filled 2=shaded 3=open
            return (Math.ceil(n / 27) - 1) % 3 + 1;
        }

        function featureOk(feature) {
            if (feature(ilist[0]) == feature(ilist[1]) && feature(ilist[1]) == feature(ilist[2]))
                return true;
            else
            if (feature(ilist[0]) == feature(ilist[1]) || feature(ilist[1]) == feature(ilist[2]) || feature(ilist[0]) == feature(ilist[2]))
                return false;
            else
                return true;
        }

        function setOk() {
            return featureOk(count) && featureOk(color) && featureOk(shape) && featureOk(fill);
        }

        return isTypeOk(ilist) && numbersOk(ilist) && cardsInHand() && setOk();
    }

    function removeCards(set) {
        for (var i = 0; i < 3; ++i) {
            setHand.removeCard(set[i]);
        }
    }

    var body = '';

    req.on('data', function (chunk) {
        body += chunk;
    });

    req.on('end', function () {
        header(res);

        var set = [];
        var id = 0;
        try {
            var ipaddr = req.connection.remoteAddress;
            var query = url.parse(req.url, true).query;
            var callback = query.callback;
            var cards = query['cards[]'];
            set = cards;
            for (var i = 0; i < 3; ++i) {
                set[i] = parseInt(set[i]);
            }
            id = query.id;
            if (isSet(set, setHand)) {
                removeCards(set);
                addCards();
                setPlayers.updateScore(id);
                log(ipaddr, id, 'Set Accepted (' + set + ')');
                var tmp = wrap(JSON.stringify(true), callback);
                res.end(tmp);
            } else {
                log(ipaddr, id, 'Set Rejected (' + set + ')');
                var tmp = wrap(JSON.stringify(false), callback);
                res.end(tmp);
            }
            updateHand();
            updateStatus();
        } catch (e) {
            errorLog('processSubmitSet', body, e);
            var tmp = wrap(JSON.stringify(false), callback);
            res.end(tmp);
        }

    });
}

/*
 * Function: processAddRow
 * Description: Processes an add row request from the client. If at least half 
 *   of the players vote for a new row then 3 new cards are added to the Hand.
 */
function processAddRow(req, res) {
    var body = '';
    req.on('data', function (chunk) {
        body += chunk;
    });
    req.on('end', function () {
        header(res);
        var id = 0;
        try {
            var ipaddr = req.connection.remoteAddress;
            var query = url.parse(req.url, true).query;
            var callback = query.callback;

            id = parseInt(query.id);
            if (setPlayers.onList(id)) {
                log(ipaddr, id, 'Add Row Request ');
                setPlayers.players[id - 1].row = true;
                updateStatus();
                if (setPlayers.isVoteOk("row")) {
                    addCards();
                    console.log("Row Added");
                    setPlayers.resetVote("row");
                }
                var tmp = wrap(JSON.stringify(true), callback);
                res.end(tmp);
            } else {
                log(ipaddr, id, 'Add Row Rejected - Invalid id');
                var tmp = wrap(JSON.stringify(false), callback);
                res.end(tmp);
            }
            updateHand();
        } catch (e) {
            errorLog('processAddRow', body, e);
            var tmp = wrap(JSON.stringify(false), callback);
            res.end(tmp);
        }

    });
}

/*
 * Function: processShuffle
 * Description: Processes a shuffle request from the client. If at least half 
 *   of the players vote for a shuffle then the Hand is randomized and broadcast 
 *   to all clients.
 */
function processShuffle(req, res) {
    var body = '';
    req.on('data', function (chunk) {
        body += chunk;
    });
    req.on('end', function () {
        header(res);

        var id = 0;
        try {
            var ipaddr = req.connection.remoteAddress;
            var query = url.parse(req.url, true).query;
            var callback = query.callback;

            id = parseInt(query.id);
            if (setPlayers.onList(id)) {
                log(ipaddr, id, 'Shuffle Requested');
                setPlayers.players[id - 1].shuffle = true;
                updateStatus();
                if (setPlayers.isVoteOk("shuffle")) {
                    setHand.shuffleCards();
                    setPlayers.resetVote("shuffle");
                }
                var tmp = wrap(JSON.stringify(true), callback);
                res.end(tmp);
            } else {
                log(ipaddr, id, 'Shuffle Rejected - Invalid id');
                var tmp = wrap(JSON.stringify(false), callback);
                res.end(tmp);
            }
            updateHand();
        } catch (e) {
            errorLog('processShuffle', body, e);
            var tmp = wrap(JSON.stringify(false), callback);
            res.end(tmp);
        }
    });
}

/*
 * Function: processEndGame
 * Description: Processes an end game request from the client. If at least half 
 *   of the players vote to end the game then the winner field of the player 
 *   with the highest score is set to true.
 */
function processEndGame(req, res) {
    var body = '';
    req.on('data', function (chunk) {
        body += chunk;
    });
    req.on('end', function () {
        header(res);

        var id = 0;
        try {
            var ipaddr = req.connection.remoteAddress;
            var query = url.parse(req.url, true).query;
            var callback = query.callback;

            id = parseInt(query.id);
            if (setPlayers.onList(id)) {
                log(ipaddr, id, 'End Game Requested');
                setPlayers.players[id - 1].end = true;
                if (setPlayers.isVoteOk("end")) {
                    setPlayers.setWinner();
                    setPlayers.resetVote("end");
                }
                updateStatus();
                var tmp = wrap(JSON.stringify(true), callback);
                res.end(tmp);
            } else {
                log(ipaddr, id, 'End Game Rejected - Invalid id');
                var tmp = wrap(JSON.stringify(false), callback);
                res.end(tmp);
            }
            updateHand();
        } catch (e) {
            errorLog('processEndGame', body, e);
            var tmp = wrap(JSON.stringify(false), callback);
            res.end(tmp);
        }

    });
}

/*
 * Function: processLoginName
 * Description: Returns the login name for the player with a given id.
 */
function processLoginName(req, res) {
    var body = '';
    req.on('data', function (chunk) {
        body += chunk;
    });
    req.on('end', function () {
        header(res);
        var id = 0;
        try {
            var ipaddr = req.connection.remoteAddress;
            var query = url.parse(req.url, true).query;
            var callback = query.callback;
            id = parseInt(query.id);

            if (id >= 1 && id <= setPlayers.players.length) {
                var lname = setPlayers.players[id - 1].player;
                log(ipaddr, id, 'Login Name Requested (' + lname + ')');
                var result = JSON.stringify(lname);
                var tmp = wrap(result, callback);
                res.end(tmp);
            } else {
                log(ipaddr, id, 'Login Name Rejected - Invalid id');
                var tmp = wrap(JSON.stringify("Error"), callback);
                res.end(tmp);
            }
        } catch (e) {
            errorLog('processLoginName', body, e);
            var tmp = wrap(JSON.stringify(false), callback);
            res.end(tmp);
        }
    });
}

// Broadcast the current hand to all players.
function updateHand() {
    io.sockets.emit("hand", setHand.cards);
}

// Broadcast the current player list to all players.
function updateStatus() {
    io.sockets.emit("players", setPlayers.players);
}

/*
 * Class: Chat
 * Description: Utility class for implementing chat function.
 */

// Constructor
var Chat = function () {
};

// Send the same message to all players
Chat.sendAll = function (message) {
    io.sockets.emit("chat", message);
};

function processChat(req, res) {
    var body = '';
    var _this = this;

    req.on('data', function (chunk) {
        body += chunk;
    });

    req.on('end', function () {
        header(res);

        try {
            console.log("url = " + req.url);
            var query = url.parse(req.url, true).query;
            var callback = query.callback;
            var playerId = parseInt(query.id);
            var myPlayer = setPlayers.getPlayer(playerId);
            var chatMessage = query.message;

            Chat.sendAll(myPlayer.player + ": " + chatMessage + "<br/>");

            var tmp = wrap(JSON.stringify(SUCCESS), callback);
            res.end(tmp);
        } catch (e) {
            errorLog('chat', body, e);
            var tmp = wrap(JSON.stringify(ERROR), callback);
            res.end(tmp);
        }
    });
}
;



// **********  Main Server Script ************* //
// Parse the http request url and delegate the handling of the services to other 
// functions.
function handler(req, res) {
    if (req.method == 'GET') {
        var pathname = url.parse(req.url).pathname;
        var command = pathname.substring(pathname.lastIndexOf("/") + 1);
        switch (command) {
            case 'login':
                processLogin(req, res);
                break;
            case 'loginname':
                processLoginName(req, res);
                break;
            case 'submitset':
                processSubmitSet(req, res);
                break;
            case 'addrow':
                processAddRow(req, res);
                break;
            case 'shuffle':
                processShuffle(req, res);
                break;
            case 'endgame':
                processEndGame(req, res);
                break;
            case 'chat':
                processChat(req, res);
                break;
            default:
                res.writeHead(404);
                res.end('Not found.');
                console.log('Error: Invalid Request: ' + req.url);
                break;
        }
    }
}

console.log("Starting Up");

// Set up http server for handling ajax calls
var app = require('http').createServer(handler),
        io = require('socket.io').listen(app);

app.listen(PORT);

// Set up socket.io connection for sending card grids and player lists
var clientList = new Object();
io.sockets.on('connection',
        function (socket) {
            var clientIPAddress = socket.request.connection.remoteAddress;
            console.log("New Connection from " + clientIPAddress);
            clientList[clientIPAddress] = 0;
        }
);



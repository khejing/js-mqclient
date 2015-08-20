/**
 * Created by ibm on 2015/4/30.
 * This File is necessary, do some simple custom wrapper, implement a better onMessage(), and most important: implement load balance client
 */

import forOwn from 'lodash/object/forOwn';
import mqtt from 'mqtt';

const LoginErrorCode = {
    'success': 0,
    'credentialError': 1,
    'reLogin': 2,
    'connectServerFailed': 3
};

let mqttClientInstance = null;
let server = null;
let serverIndex = 0;
let clientId = null;
let msgTopicTypeCb = {};

var mqttClient = {
    connect: function(args){
		clientId = args.id;
        server = args.server;
        mqttClientInstance = mqtt.connect(server, {clean: args.cleanSession, clientId: clientId});
        // here don't utilize loop provided by event-emitter on(), and implement it again, cause on() can't log unknown messsage, and it need many if(...)... in message callback
        mqttClientInstance.on('connect', function () {
            console.log("connect mqtt server success");
            window.addEventListener('unload', function () {
                this.destroy();
            }.bind(this));
            mqttClientInstance.on('message', function(topic, message) {
                let msgTypeCb = msgTopicTypeCb[topic];
                let msgHandled = false;
                if(msgTypeCb){
                    let jsonObj = null;
                    try{
                        jsonObj = JSON.parse(message);
                        console.log("recv json from "+topic+": "+message);
                    } catch(e){
                        console.log("recv advisory from "+topic+": "+message.toString());
                        for(let i = 0; i < msgTypeCb["advisory"].length; i++){
                            (msgTypeCb["advisory"][i])(message);
                        }
                        msgHandled = true;
                    }
                    if(jsonObj){
                        forOwn(msgTypeCb, function(value, key){
                            if(jsonObj[key]){
                                // if registerd, value.length must be > 0, or it will not exist, see offMessage()
                                let retPromise = null;
                                for(let i = 0; i < value.length; i++){
                                    retPromise = (value[i])(jsonObj, retPromise);
                                }
                                msgHandled = true;
                                return false;
                            }
                        });
                    }
                }
                if(!msgHandled) {
                    console.log("unknown message!");
                }
            });
            args.cb(LoginErrorCode.success);
        }.bind(this));
        this.onError(function(error){
            console.log("mqtt connect failed: ", error);
            if(error.message.match(/Identifier rejected/)){
                args.cb(LoginErrorCode.reLogin);
            } else {
                args.cb(LoginErrorCode.connectServerFailed);
            }
            //TODO: here need consider mqtt server failover
            //if(isArray(args.servers)) {
                //serverIndex++;
                //if(serverIndex == args.servers.length) {
                //    // We tried all the servers the user gave us and they all failed
                //    console.log("Error connecting to any of the provided mqtt servers: Is the mqtt server down?");
                //    return;
                //}
                //// Let's try the next server
                //server = args.servers[serverIndex];
                //setTimeout(function() { this.connect(); }, 200);
            //}
        });
    },
    destroy: function(){
        if(mqttClientInstance){
            mqttClientInstance.end();
            mqttClientInstance = null;
            console.log("mqtt client has been destroyed");
        }
    },
    subscribe: function(topic){
        //TODO: {qos: 1}, make clear whether subscribe 0 and clean false won't receive old message
        mqttClientInstance.subscribe(topic);
    },
    publish: function(topic, object){
		object["clientId"] = clientId;
		let strToSend = JSON.stringify(object);
		console.log("send to " + topic + ": " + strToSend);
        //TODO: {qos: 1}, make clear whether publish 0 and clean false won't receive old message by the other
        mqttClientInstance.publish(topic, strToSend);
    },
    onMessage: function(topic, type, cb){
        if(!msgTopicTypeCb[topic]){
            msgTopicTypeCb[topic] = {};
        }
        if(!msgTopicTypeCb[topic][type]){
            msgTopicTypeCb[topic][type] = [];
        }
        msgTopicTypeCb[topic][type].push(cb);
    },
    offMessage: function(topic, type, cb){
        if(msgTopicTypeCb[topic]){
            for(let i = 0; i < msgTopicTypeCb[topic][type].length; i++){
                if(msgTopicTypeCb[topic][type][i] === cb){
                    if(msgTopicTypeCb[topic][type].length === 1){
                        delete msgTopicTypeCb[topic][type];
                    }else{
                        msgTopicTypeCb[topic][type].splice(i, 1);
                    }
                    return;
                }
            }
        }
    },
    onClose: function(cb){
        mqttClientInstance.on('close', cb);
    },
    onError: function(cb){
        mqttClientInstance.on('error',cb);
    }
};

export {LoginErrorCode};
export default mqttClient;
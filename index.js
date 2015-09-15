/**
 * Created by ibm on 2015/4/30.
 * This File is necessary, do some simple custom wrapper, implement a better onMessage(), and most important: implement load balance client
 */

import forOwn from 'lodash/object/forOwn';
let mqtt;
let myService;
if(NETWORK_TYPE === 'websocket'){
	mqtt = require('mqtt');
}else if(NETWORK_TYPE === 'cordova'){
    myService = cordova.require("cordova-plugin-transparent-webview-service.TransparentWebViewService");
}

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
// only useful when NETWORK_TYPE === 'websocket'
let initializationFinished = false;

let mqttClient = {
    connect: function(args){
		clientId = args.id;
        server = args.server;
		let opts = {clean: args.cleanSession, clientId: clientId};
		let errorCb = function(error){
            if(NETWORK_TYPE === 'websocket' && PLATFORM === 'android'){
                console.log("mqtt connect in background service failed: ", error);
                simpleCordova.onMessage({type: "LoginError", error: error});
                return;
            }
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
		}
		let successCb = function(){
            if(NETWORK_TYPE === 'websocket'){
                console.log("connect mqtt server success");
                //TODO: to see whether below effect
                window.addEventListener('unload', function () {
                    this.destroy();
                }.bind(this));
            }
            // messageCb don't utilize loop provided by event-emitter on(), and implement it again, cause on() can't log unknown messsage, and it need many if(...)... in message callback
            let messageCb = function(topic, message) {
                if(NETWORK_TYPE === 'websocket' && PLATFORM === 'android'){
                    if(simpleCordova.isActivityBound() && initializationFinished){
                        console.log("has activity, send to it message: "+message+", and topic: "+topic);
                        simpleCordova.onMessage({type: "Message", topic: topic, message: message});
                        return;
                    }
                }
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
            };
			if(NETWORK_TYPE === 'websocket'){
				mqttClientInstance.on('message', messageCb);
                if(PLATFORM === 'android'){
                    simpleCordova.onMessage({type: "LoginSuccess"});
                }
                args.cb(LoginErrorCode.success);
                initializationFinished = true;
			}else if(NETWORK_TYPE === 'cordova'){
                myService.registerForUpdates(function(ret){
                    if(ret.LatestResult){
                        if(ret.LatestResult.type === 'PageFinished'){
                            console.log("main activity received background PageFinished update")
                            myService.setConfiguration({
                                type: "LoginInfo",
                                username: args.username,
                                password: args.password,
                                role: args.role
                            }, function(){
                                console.log("login info has been set into background service");
                            }, function(){
                                console.log("background service set configuration error");
                            });
                        }else if(ret.LatestResult.type === 'LoginSuccess'){
                            console.log("main activity receive background LoginSuccess update");
                            args.cb(LoginErrorCode.success);
                        }else if(ret.LatestResult.type === 'LoginError'){
                            console.log("main activity receive background LoginError update");
                            errorCb(ret.LatestResult.error);
                        }else if(ret.LatestResult.type === 'Message'){
                            console.log("main activity recevie message from background");
                            messageCb(ret.LatestResult.topic, ret.LatestResult.message);
                        }
                    }else{
                        console.log("background service registering for updates: "+ret.RegisteredForUpdates);
                    }
                }, function(){
                    console.log("background service registering for updates error");
                });
			}
		}.bind(this);
		if(NETWORK_TYPE === 'websocket'){
            mqttClientInstance = mqtt.connect(server, opts);
            mqttClientInstance.on('connect', successCb);
            this.onError(errorCb);
		}else if(NETWORK_TYPE === 'cordova'){
            if(!localStorage.loginInfo){
                myService.startService(function(ret){
                    console.log("background service running: "+ret.ServiceRunning);
                    myService.registerForBootStart(function(ret){
                        console.log("background service registering for boot start: "+ret.RegisteredForBootStart);
                    }, function(){
                        console.log("background service registering for boot start error");
                    });
                }, function(){
                    console.log("background service start service error");
                });
            }
            successCb();
		}
    },
    destroy: function(){
		if(NETWORK_TYPE === 'websocket'){
            if(mqttClientInstance){
                mqttClientInstance.end();
                mqttClientInstance = null;
            }
		}else if(NETWORK_TYPE === 'cordova'){
            //TODO: add logout in background.js here
            myService.stopService(function(ret){
                console.log("background service running: "+ret.ServiceRunning);
                myService.deregisterForBootStart(function(ret){
                    console.log("background service deregistering for boot start: "+ret.RegisteredForBootStart);
                }, function(){
                    console.log("background service deregistering for boot start error");
                });
                myService.deregisterForUpdates(function(ret){
                    console.log("background service deregistering for updates: "+ret.RegisteredForUpdates);
                }, function(){
                    console.log("background service deregistering for updates error");
                });
            }, function(){
                console.log("background service stop service error");
            });
		}
        console.log("destroy mqtt client");
    },
    subscribe: function(topic){
        //TODO: {qos: 1}, make clear whether subscribe 0 and clean false won't receive old message
		if(NETWORK_TYPE === 'websocket'){
			mqttClientInstance.subscribe(topic);
		}else if(NETWORK_TYPE === 'cordova'){
            myService.setConfiguration({
                type: "Subscribe",
                topic: topic
            }, function(){
                console.log("subscribe "+topic+" info has been set into background service");
            }, function(){
                console.log("set subscribe "+topic+" info into background service error");
            });
		}
    },
    publish: function(topic, object){
		object["clientId"] = clientId;
		let strToSend = JSON.stringify(object);
		console.log("send to " + topic + ": " + strToSend);
        //TODO: {qos: 1}, make clear whether publish 0 and clean false won't receive old message by the other
        if(NETWORK_TYPE === 'websocket'){
			mqttClientInstance.publish(topic, strToSend);
		}else if(NETWORK_TYPE === 'cordova'){
            myService.setConfiguration({
                type: "Publish",
                topic: topic,
                message: strToSend
            }, function(){
                console.log("publish info has been set into background service");
            }, function(){
                console.log("set publish info into background service error");
            });
		}
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
		if(NETWORK_TYPE === 'websocket'){
			mqttClientInstance.on('close', cb);
		}else if(NETWORK_TYPE === 'cordova'){
			//do nothing now
		}
    },
    onError: function(cb){
        mqttClientInstance.on('error',cb);
    }
};

export {LoginErrorCode};
export default mqttClient;
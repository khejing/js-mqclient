/**
 * Created by ibm on 2015/4/30.
 * This File is necessary, do some simple custom wrapper, implement a better onMessage(), and most important: implement load balance client
 */

import forOwn from 'lodash/object/forOwn';
import Logger from 'logger.js';

let mqtt;
let BackgroundService;
if(NETWORK_TYPE === 'websocket'){
	mqtt = require('mqtt');
}else if(NETWORK_TYPE === 'cordova'){
  BackgroundService = cordova.require("cordova-plugin-transparent-webview-service.TransparentWebViewService");
}

const LoginErrorCode = {
  'success': 0,
  'userNotExist': 1,
  'passwordError': 2,
  'reLogin': 3,
  'connectServerFailed': 4
};

let mqttClientInstance = null;
let server = null;
let serverIndex = 0;
let clientId = null;
let msgTopicTypeCb = {};
// only useful when (NETWORK_TYPE === 'websocket' && PLATFORM === 'android')
let initializationFinished = false;

let mqClient = {
  connect: function(args){
    clientId = args.id;
    server = args.server;
    let opts = {clean: args.cleanSession, clientId: clientId, keepalive: 5, reconnectPeriod: 8000};
    let errorCb = function(error){
      if(NETWORK_TYPE === 'websocket'){
        Logger.error("mqtt connect failed: "+error.message);
        if(PLATFORM === 'android'){
          simpleCordova.onMessage(JSON.stringify({type: "LoginError", error: {message: error.message}}));
          return;
        }
      }
      if(error.message.match(/Identifier rejected/)){
        //args.cb(LoginErrorCode.reLogin);
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
    let successCb = function(serviceState){
      if(NETWORK_TYPE === 'websocket'){
        Logger.info({eto1_logtype: "online"});
      }
      // messageCb don't utilize loop provided by event-emitter on(), and implement it again, cause on() can't log unknown messsage, and it need many if(...)... in message callback
      // NOTE: message is a Buffer object, not a string
      let messageCb = function(topic, message) {
        if(NETWORK_TYPE === 'websocket' && PLATFORM === 'android'){
          if(simpleCordova.isActivityBound() && initializationFinished){
            Logger.info(Object.assign({eto1_logtype: "send2activity", topic: topic}, JSON.parse(message)));
            simpleCordova.onMessage(JSON.stringify({type: "Message", topic: topic, message: message.toString()}));
            return;
          }
        }
        let msgTypeCb = msgTopicTypeCb[topic];
        let msgHandled = false;
        if(msgTypeCb){
          let jsonObj = null;
          try{
            jsonObj = JSON.parse(message);
            Logger.info(Object.assign({eto1_logtype: "recv", topic: topic}, jsonObj));
          } catch(e){
            Logger.info("recv advisory from "+topic+": "+message);
            for(let i = 0; i < msgTypeCb["advisory"].length; i++){
              (msgTypeCb["advisory"][i])(message);
            }
            msgHandled = true;
          }
          if(jsonObj){
            forOwn(msgTypeCb, function(value, key){
              if(jsonObj[key]){
                // if registerd, value.length must be > 0, or jsonObj[key] will not exist, see offMessage()
                let promise = Promise.resolve();
                for(let i = 0; i < value.length; i++){
                  promise = promise.then(function(ret){
                    //有可能在回调函数中修改value，因此需要判断
                    if(value[i]){
                      return (value[i])(jsonObj, ret);
                    }
                  });
                }
                msgHandled = true;
                return false;
              }
            });
          }
        }
        if(!msgHandled) {
          Logger.info(Object.assign({eto1_logtype: "unknowMsg", topic: topic}, JSON.parse(message)));
        }
      };
      if(NETWORK_TYPE === 'websocket'){
        //TODO: 换成listenerCount()
        if(mqttClientInstance.listeners('message').length === 0){
          mqttClientInstance.on('message', messageCb);
        }
        args.cb(LoginErrorCode.success);
      }else if(NETWORK_TYPE === 'cordova'){
        let updateCb = function(ret){
          if(ret.LatestResult && ret.LatestResult.type){
            if(ret.LatestResult.type === 'PageFinished'){
              Logger.info({eto1_logtype: "serviceUpdate", LatestResultType: "PageFinished"});
              BackgroundService.setConfiguration({
                type: "LoginInfo",
                username: args.username,
                password: args.password,
                role: args.role
              }, function(){
              }, function(){
                Logger.error("set login info into background service error");
              });
            }else if(ret.LatestResult.type === 'LoginSuccess'){
              Logger.info({eto1_logtype: "serviceUpdate", LatestResultType: "LoginSuccess"});
              args.cb(LoginErrorCode.success);
            }else if(ret.LatestResult.type === 'LoginError'){
              Logger.info({eto1_logtype: "serviceUpdate", LatestResultType: "LoginError", error: ret.LatestResult.error.message});
              errorCb(ret.LatestResult.error);
            }else if(ret.LatestResult.type === 'Logout'){
              BackgroundService.stopService(function(stopServiceRet){
                BackgroundService.deregisterForBootStart(function(deRegBootStartRet){
                  BackgroundService.deregisterForUpdates(function(deRegUpdateRet){
                    Logger.info({
                      eto1_logtype: "serviceUpdate",
                      LatestResultType: "Logout",
                      ServiceRunning: stopServiceRet.ServiceRunning,
                      RegisteredForBootStart: deRegBootStartRet.RegisteredForBootStart,
                      RegisteredForupdates: deRegUpdateRet.RegisteredForUpdates
                    });
                  }, function(){
                    Logger.error("background service deregistering for updates error");
                  });
                }, function(){
                  Logger.error("background service deregistering for boot start error");
                });
              }, function(){
                Logger.error("background service stop service error");
              });
            }else if(ret.LatestResult.type === 'Message'){
              Logger.info({eto1_logtype: "recvMessageFromBack", topic: ret.LatestResult.topic, message: ret.LatestResult.message});
              messageCb(ret.LatestResult.topic, ret.LatestResult.message);
            }
          }else{
            Logger.info({eto1_logtype: "serviceUpdate", LatestResultType: "null"});
            if(ret.RegisteredForUpdates && serviceState === 'ServiceAlreadyStarted'){
              args.cb(LoginErrorCode.success);
            }
          }
        };
        //should call every time when started, it will deregisterForUpdates previous callback automatically
        BackgroundService.registerForUpdates(updateCb, function(){
          Logger.error("background service registering for updates error");
        });
      }
    }.bind(this);
    if(NETWORK_TYPE === 'websocket'){
      mqttClientInstance = mqtt.connect(server, opts);
      mqttClientInstance.on('connect', successCb);
      mqttClientInstance.on('offline', function(){
        Logger.info({eto1_logtype: "offline"});
      });
      this.onError(errorCb);
    }else if(NETWORK_TYPE === 'cordova'){
      // getStatus() will call bindService()
      BackgroundService.getStatus(function(status){
        if(!status.ServiceRunning){
          BackgroundService.startService(function(ret){
            Logger.info("after start service, background service running: "+ret.ServiceRunning);
            if(!status.RegisteredForBootStart){
              BackgroundService.registerForBootStart(function(ret){
                Logger.info("background service registering for boot start: "+ret.RegisteredForBootStart);
              }, function(){
                Logger.error("background service registering for boot start error");
              });
            }
            successCb();
          }, function(){
            Logger.error("background service start service error");
          });
        }else{
          Logger.info({eto1_logtype: "serviceAlreadyStartedInLogin"});
          successCb('ServiceAlreadyStarted');
        }
      }, function(){
        Logger.error("background service getting status error");
      });
    }
  },
  destroy: function(){
    if(NETWORK_TYPE === 'websocket'){
      if(mqttClientInstance){
        mqttClientInstance.end();
        mqttClientInstance = null;
      }
      if(PLATFORM === 'android'){
        Logger.info("destroy mqtt client in background service");
        simpleCordova.onMessage(JSON.stringify({type: "Logout"}));
      }else{
        Logger.info("destroy mqtt client");
      }
    }else if(NETWORK_TYPE === 'cordova'){
      BackgroundService.setConfiguration({type: "Logout"}, function(){
        Logger.info("logout info has been set into background service");
      }, function(){
        Logger.error("set logout info into background service error");
      });
    }
  },
  subscribe: function(topic){
    if(NETWORK_TYPE === 'websocket'){
      mqttClientInstance.subscribe(topic, {qos: 1});
    }else if(NETWORK_TYPE === 'cordova'){
      BackgroundService.setConfiguration({
        type: "Subscribe",
        topic: topic
      }, function(){
        Logger.info({eto1_logtype: "subscribe2service", topic: topic});
      }, function(){
        Logger.error("set subscribe "+topic+" info into background service error");
      });
    }
  },
  publish: function(topic, object){
    object["clientId"] = clientId;
    let strToSend = JSON.stringify(object);
    if(NETWORK_TYPE === 'websocket'){
      mqttClientInstance.publish(topic, strToSend);
      Logger.info(Object.assign({eto1_logtype: "websocketPublish", topic: topic}, object));
    }else if(NETWORK_TYPE === 'cordova'){
      BackgroundService.setConfiguration({
        type: "Publish",
        topic: topic,
        message: object
      }, function(){
        Logger.info(Object.assign({eto1_logtype: "publish2service", topic: topic}, object));
      }, function(){
        Logger.error(Object.assign({eto1_logtype: "publish2service", topic: topic}, object));
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
    mqttClientInstance.on('error', cb);
  },
  // only useful when (NETWORK_TYPE === 'websocket' && PLATFORM === 'android')
  setInitializationFinished: function(){
    initializationFinished = true;
  }
};

export {LoginErrorCode};
export default mqClient;

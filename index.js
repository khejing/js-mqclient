/**
 * Created by ibm on 2015/4/30.
 * This File is necessary, do some simple custom wrapper, implement a better onMessage(), and most important: implement load balance client
 */

import forOwn from 'lodash/object/forOwn';
import Logger from 'logger.js';

let mqtt = require('mqtt');

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
let connected = false;

let mqClient = {
  connect: function(args){
    clientId = args.id;
    server = args.server;
    let opts = {clean: args.cleanSession, clientId: clientId};
    let successCb = function(){
      Logger.info({eto1_logtype: "online"});
      // messageCb don't utilize loop provided by event-emitter on(), and implement it again, cause on() can't log unknown messsage, and it need many if(...)... in message callback
      // NOTE: message is a Buffer object, not a string
      let messageCb = function(topic, message) {
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
      //TODO: 换成listenerCount()
      if(mqttClientInstance.listeners('message').length === 0){
        mqttClientInstance.on('message', messageCb);
      }
      args.cb(LoginErrorCode.success);
    }.bind(this);
    let offlineCb = function(){
      mqttClientInstance.connected = false;
      Logger.info({eto1_logtype: "offline"});
    };
    let errorCb = function(error){
      Logger.error("mqtt connect failed: "+error.message);
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
    };
    mqttClientInstance = mqtt.connect(server, opts);
    mqttClientInstance.on('connect', successCb);
    mqttClientInstance.on('offline', offlineCb);
    this.onError(errorCb);
  },
  destroy: function(){
    if(mqttClientInstance){
      mqttClientInstance.end();
      mqttClientInstance = null;
    }
    Logger.info("destroy mqtt client");
  },
  subscribe: function(topic){
    mqttClientInstance.subscribe(topic, {qos: 1});
  },
  publish: function(topic, object){
    object["clientId"] = clientId;
    let strToSend = JSON.stringify(object);
    Logger.info(Object.assign({eto1_logtype: "websocketPublish", topic: topic}, object));
    mqttClientInstance.publish(topic, strToSend);
  },
  publishReliably: function(topic, object){
    object["clientId"] = clientId;
    let strToSend = JSON.stringify(object);
    Logger.info(Object.assign({eto1_logtype: "websocketPublishReliably", topic: topic}, object));
    mqttClientInstance.publish(topic, strToSend, {qos: 1});
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
    if(msgTopicTypeCb[topic] && msgTopicTypeCb[topic][type]){
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
    mqttClientInstance.on('error', cb);
  },
  isConnected: function(){
    return mqttClientInstance.connected;
  }
};

export {LoginErrorCode};
export default mqClient;

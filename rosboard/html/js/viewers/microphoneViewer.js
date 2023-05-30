const video = document.getElementById('video')
var connected = false;


function sendAudioData(inputData, socket) {

    
    const byteArray = new Float32Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      byteArray[i] = inputData[i];
    }

    const buffer = new ArrayBuffer(byteArray.length * 4);
    const view = new DataView(buffer);
    byteArray.forEach((value, index) => {
      view.setFloat32(index * 4, value, true);
    });
    console.log('buffer b4');

    socket.send(buffer);
    // });

    // Listen for messages
    // socket.addEventListener("message", (event) => {
    //   console.log("Message from server ", event.data);
    // });
      
    //   socket.onmessage = () => {
    //     console.log("WebSocket connection established");

    //   };
    socket.onclose = () => {
        console.log("WebSocket connection closed");
    };

    socket.onerror = (error) => {
        console.error("WebSocket error:", error);
    };
}

function startup()
{   
console.log('hello')
const audioContext = new AudioContext();
///////////////////////////////////////////////////////////////

//////////////////////////////////////////////////
const mediaStream = navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    // video.srcObject = stream;
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);  
    source.connect(processor);

    processor.connect(audioContext.destination);
    const socket = new WebSocket('wss://agilex:1234'); // Create a WebSocket to communicate with the Python server
    console.log(connected)
    socket.onopen = () => {
        console.log("WebSocket connection established");
        connected = true;

      };

    if (connected == true)
    {
     console.log(connected);
      processor.addEventListener('audioprocess', event => 
      {
          const inputData = event.inputBuffer.getChannelData(0);
          sendAudioData(inputData, socket);
      })
    }
  })
  .catch(error => {
    console.log('getUserMedia error:', fucked);
  });
}


// Start button for server to client
function start() {
  document.getElementById('start').style.display = 'none';

  pc = createPeerConnection();

  var time_start = null;

  function current_stamp() {
      if (time_start === null) {
          time_start = new Date().getTime();
          return 0;
      } else {
          return new Date().getTime() - time_start;
      }
  }

  if (document.getElementById('use-datachannel').checked) {
      var parameters = JSON.parse(document.getElementById('datachannel-parameters').value);

      dc = pc.createDataChannel('chat', parameters);
      dc.onclose = function() {
          clearInterval(dcInterval);
          dataChannelLog.textContent += '- close\n';
      };
      dc.onopen = function() {
          dataChannelLog.textContent += '- open\n';
          dcInterval = setInterval(function() {
              var message = 'ping ' + current_stamp();
              dataChannelLog.textContent += '> ' + message + '\n';
              dc.send(message);
          }, 1000);
      };
      dc.onmessage = function(evt) {
          dataChannelLog.textContent += '< ' + evt.data + '\n';

          if (evt.data.substring(0, 4) === 'pong') {
              var elapsed_ms = current_stamp() - parseInt(evt.data.substring(5), 10);
              dataChannelLog.textContent += ' RTT ' + elapsed_ms + ' ms\n';
          }
      };
  }

  var constraints = {
      audio: document.getElementById('use-audio').checked,
      video: false
  };

  if (document.getElementById('use-video').checked) {
      var resolution = document.getElementById('video-resolution').value;
      if (resolution) {
          resolution = resolution.split('x');
          constraints.video = {
              width: parseInt(resolution[0], 0),
              height: parseInt(resolution[1], 0)
          };
      } else {
          constraints.video = true;
      }
  }

  if (constraints.audio || constraints.video) {
      if (constraints.video) {
          document.getElementById('media').style.display = 'block';
      }
      navigator.mediaDevices.getUserMedia(constraints).then(function(stream) {
          stream.getTracks().forEach(function(track) {
              pc.addTrack(track, stream);
          });
          return negotiate();
      }, function(err) {
          alert('Could not acquire media: ' + err);
      });
  } else {
      negotiate();
  }

  document.getElementById('stop').style.display = 'inline-block';
}

function stop() {
  document.getElementById('stop').style.display = 'none';

  // close data channel
  if (dc) {
      dc.close();
  }

  // close transceivers
  if (pc.getTransceivers) {
      pc.getTransceivers().forEach(function(transceiver) {
          if (transceiver.stop) {
              transceiver.stop();
          }
      });
  }

  // close local audio / video
  pc.getSenders().forEach(function(sender) {
      sender.track.stop();
  });

  // close peer connection
  setTimeout(function() {
      pc.close();
  }, 500);
}

// Negotiate WebRTC connection
function negotiate() {
  return pc.createOffer({offerToReceiveAudio:true}).then(function(offer) {
      return pc.setLocalDescription(offer);
  }).then(function() {
      // wait for ICE gathering to complete
      return new Promise(function(resolve) {
          if (pc.iceGatheringState === 'complete') {
              resolve();
          } else {
              function checkState() {
                  if (pc.iceGatheringState === 'complete') {
                      pc.removeEventListener('icegatheringstatechange', checkState);
                      resolve();
                  }
              }
              pc.addEventListener('icegatheringstatechange', checkState);
          }
      });
  }).then(function() {
      var offer = pc.localDescription;
      var codec;

      codec = document.getElementById('audio-codec').value;
      if (codec !== 'default') {
          offer.sdp = sdpFilterCodec('audio', codec, offer.sdp);
      }

      codec = document.getElementById('video-codec').value;
      if (codec !== 'default') {
          offer.sdp = sdpFilterCodec('video', codec, offer.sdp);
      }

      document.getElementById('offer-sdp').textContent = offer.sdp;
      return fetch('/offer', {
          body: JSON.stringify({
              sdp: offer.sdp,
              type: offer.type,
              video_transform: document.getElementById('video-transform').value
          }),
          headers: {
              'Content-Type': 'application/json'
          },
          method: 'POST'
      });
  }).then(function(response) {
      return response.json();
  }).then(function(answer) {
      document.getElementById('answer-sdp').textContent = answer.sdp;
      return pc.setRemoteDescription(answer);
  }).catch(function(e) {
      alert(e);
  });
}

function sdpFilterCodec(kind, codec, realSdp) {
  var allowed = []
  var rtxRegex = new RegExp('a=fmtp:(\\d+) apt=(\\d+)\r$');
  var codecRegex = new RegExp('a=rtpmap:([0-9]+) ' + escapeRegExp(codec))
  var videoRegex = new RegExp('(m=' + kind + ' .*?)( ([0-9]+))*\\s*$')
  
  var lines = realSdp.split('\n');

  var isKind = false;
  for (var i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('m=' + kind + ' ')) {
          isKind = true;
      } else if (lines[i].startsWith('m=')) {
          isKind = false;
      }

      if (isKind) {
          var match = lines[i].match(codecRegex);
          if (match) {
              allowed.push(parseInt(match[1]));
          }

          match = lines[i].match(rtxRegex);
          if (match && allowed.includes(parseInt(match[2]))) {
              allowed.push(parseInt(match[1]));
          }
      }
  }

  var skipRegex = 'a=(fmtp|rtcp-fb|rtpmap):([0-9]+)';
  var sdp = '';

  isKind = false;
  for (var i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('m=' + kind + ' ')) {
          isKind = true;
      } else if (lines[i].startsWith('m=')) {
          isKind = false;
      }

      if (isKind) {
          var skipMatch = lines[i].match(skipRegex);
          if (skipMatch && !allowed.includes(parseInt(skipMatch[2]))) {
              continue;
          } else if (lines[i].match(videoRegex)) {
              sdp += lines[i].replace(videoRegex, '$1 ' + allowed.join(' ')) + '\n';
          } else {
              sdp += lines[i] + '\n';
          }
      } else {
          sdp += lines[i] + '\n';
      }
  }

  return sdp;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

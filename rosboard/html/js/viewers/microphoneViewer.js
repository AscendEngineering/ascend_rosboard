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

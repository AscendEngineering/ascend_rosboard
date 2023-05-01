const video = document.getElementById('video')

function sendAudioData(inputData) {


    const socket = new WebSocket('ws://localhost:1234'); // Create a WebSocket to communicate with the Python server

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

    socket.onopen = () => {
        console.log("WebSocket connection established");
        socket.send(buffer);
      };
      
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
const mediaStream = navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    video.srcObject = stream;
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);  
    source.connect(processor);

    processor.connect(audioContext.destination);

    processor.addEventListener('audioprocess', event => {
        const inputData = event.inputBuffer.getChannelData(0);
        // console.log(inputData);
        // console.log('fml')
        sendAudioData(inputData);
    })
  })
  .catch(error => {
    console.log('getUserMedia error:', fucked);
  });
}
window.addEventListener('load', startup, false);  
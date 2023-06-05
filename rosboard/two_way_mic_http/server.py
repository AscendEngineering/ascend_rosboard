import argparse
import asyncio
import json
import logging
import os
import ssl
import uuid
import pyaudio
import numpy as np
import concurrent.futures
import multiprocessing

from threading import Thread, Event, Lock

from aiohttp import web
from aiortc import MediaStreamTrack, RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaRelay
from av import AudioFrame

ROOT = os.path.dirname(__file__)

logger = logging.getLogger("pc")
pcs = set()
relay = MediaRelay()

class SystemMic(MediaStreamTrack):
    kind = "audio"
    
    def __init__(self):
        print("System Mic Initialized")
        super().__init__()
        
        self.kind         = "audio"
        self.RATE         = 44100
        self.AUDIO_PTIME  = 0.020                                    # 20ms audio packetization
        self.SAMPLES      = int(self.AUDIO_PTIME * self.RATE)
        self.FORMAT       = pyaudio.paInt32
        self.CHANNELS     = 2
        self.CHUNK        = int(self.RATE*self.AUDIO_PTIME)
        self.FORMATAF     = 's16'   #'s32'                           # s32_le
        self.LAYOUT       = 'stereo'
        self.sampleCount  = 0

        self.audio        = pyaudio.PyAudio()
        self.stream       = self.audio.open(format=self.FORMAT, channels=self.CHANNELS, rate=self.RATE,
                                            input=True, 
                                            frames_per_buffer=self.CHUNK)
        #thread
        self.micData          = None
        self.micDataLock      = Lock()
        self.newMicDataEvent  = Event()
        self.newMicDataEvent.clear()
        self.captureThread    = Thread(target=self.capture)
        self.captureThread.start()
        

    def capture(self):
        print("System Mic Capture Started")
        while True:
            data  = np.fromstring(self.stream.read(self.CHUNK),dtype=np.int32)
            
            with self.micDataLock:
                self.micData = data
                self.newMicDataEvent.set()
    
        
    async def recv(self):
        print("recv")
        newMicData = None
            
        self.newMicDataEvent.wait()

        with self.micDataLock:
            data  = self.micData
            data  = (data/2).astype('int32')
            data  = np.array([(data>>16).astype('int16')])
            self.newMicDataEvent.clear()
        
        frame   = AudioFrame.from_ndarray(data, self.FORMATAF, layout=self.LAYOUT)
        frame.pts         = self.sampleCount
        frame.rate        = self.RATE
        self.sampleCount += frame.samples

        return frame

    def stop(self):
        super.stop()
        self.captureThread.kill()





def createAudioOutputStream():
    import pyaudio
    print("Creating audio output stream (for client to server)")
    p = pyaudio.PyAudio()
    chunk = 8192  # Number of audio samples per chunk
    format = pyaudio.paFloat32  # Audio format
    channels = 1  # Number of audio channels (mono)
    rate = 44100  # Sample rate (Hz)
    stream_out = p.open(format=format,
                        channels=channels,
                        rate=rate,
                        output=True,
                        output_device_index=0,
                        frames_per_buffer=chunk)
    return stream_out
    
def playAudio(frame_queue):
    stream_out = None
    while True:
        frame = frame_queue.get()  # Get audio frame from the frame_queue
        if frame is None:
            print("No frame currently")
        elif stream_out is None:
            stream_out = createAudioOutputStream()
        else:
            print("Play audio")
            try:
                stream_out.write(frame)
            except Exception as e:
                print(e)

frame_queue = multiprocessing.Queue()  # Queue to hold audio frames
started = False
def playAudioProcess(frame):
    global frame_queue
    global started
    if(not started):
        started = True
        audio_process = multiprocessing.Process(target=playAudio, args=(frame_queue,)) # Create audio process
        audio_process.start() # Start audio process
    print(frame_queue.qsize())
    frame_queue.put(frame) # Put audio frame in frame_queue
    print(frame_queue.qsize())

async def index(request):
    content = open(os.path.join(ROOT, "index.html"), "r").read()
    return web.Response(content_type="text/html", text=content)


async def javascript(request):
    content = open(os.path.join(ROOT, "client.js"), "r").read()
    return web.Response(content_type="application/javascript", text=content)


async def offer(request):
    print("OFFER")
    params = await request.json()
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])

    pc = RTCPeerConnection()
    pc_id = "PeerConnection(%s)" % uuid.uuid4()
    pcs.add(pc)

    def log_info(msg, *args):
        logger.info(pc_id + " " + msg, *args)

    log_info("Created for %s", request.remote)

    
    

    @pc.on("datachannel")
    def on_datachannel(channel):
        @channel.on("message")
        def on_message(message):
                playAudioProcess(message)

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        log_info("Connection state is %s", pc.connectionState)
        if pc.connectionState == "failed":
            await pc.close()
            pcs.discard(pc)

    @pc.on("track")
    def on_track(track):
        log_info("Track %s received", track.kind)

        if track.kind == "audio":
            pc.addTrack(SystemMic())
            #pc.addTrack(SystemMic())
            #recorder.addTrack(track)

        @track.on("ended")
        async def on_ended():
            log_info("Track %s ended", track.kind)

    # handle offer
    await pc.setRemoteDescription(offer)

    # send answer
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    return web.Response(
        content_type="application/json",
        text=json.dumps(
            {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}
        ),
    )




async def on_shutdown(app):
    # close peer connections
    coros = [pc.close() for pc in pcs]
    await asyncio.gather(*coros)
    pcs.clear()


def main(host="0.0.0.0", port="8080", verbose=False, cert_file=None, key_file=None):
    if verbose:
        print("Logging at debug level.")
        logging.basicConfig(level=logging.DEBUG)
    else:
        print("Logging at info level.")
        logging.basicConfig(level=logging.INFO)

    if cert_file and key_file:
        print("Cert file: %s" % cert_file)
        print("Key  file: %s" % key_file)
        ssl_context = ssl.SSLContext()
        ssl_context.load_cert_chain(cert_file, key_file)
    else:
        print("WARNING: Running without SSL.")
        ssl_context = None

    app = web.Application()
    app.on_shutdown.append(on_shutdown)
    app.router.add_get("/", index)
    app.router.add_get("/client.js", javascript)
    app.router.add_get("/assets/buffer-detector.js", javascript)
    app.router.add_post("/offer", offer)

    web.run_app(
        app, access_log=None, host=host, port=port, ssl_context=ssl_context
    )


if __name__ == "__main__":
    main()

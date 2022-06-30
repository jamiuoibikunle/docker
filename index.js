const app = require('express')()
const http = require('http')
const { Server } = require('socket.io')
const server = http.createServer(app)
const cors = require('cors')
const mediasoup = require('mediasoup')

app.use(cors())
app.get('/', (req, res) => {
  res.send('Working.....')
})

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
})

app.get('/', (req, res) => {
  res.send('Server is running')
})

let worker
let router
let producerTransport
let producer
let consumerTransport
let consumer

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020
  })

  console.log('Worker PID', worker.pid)
  worker.on('died', () => {
    console.error('Worker has died')
    setTimeout(() => {
      process.exit(1)
    }, 2000)
  })
  return worker
}

createWorker()

const mediaCodecs = [
  {
    kind        : "audio",
    mimeType    : "audio/opus",
    clockRate   : 48000,
    channels    : 2
  },
  {
    kind       : "video",
    mimeType   : "video/VP8",
    clockRate  : 90000,
    parameters :
    {
      'x-google-start-bitrate': 1000
    }
  }
]

const createWebRtcTransport = async (callback) => {
  try {
    webRtcTransport_options = {
      listenIps: [
        {
          ip: '0.0.0.0',
          announcedIp: '127.0.0.1'
        }
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    }

    let transport = await router.createWebRtcTransport(webRtcTransport_options)
    console.log('Transport ID: ', transport.id)
    
    transport.on('dtlsStateChange', dtlsState => {
      if (dtlsState === 'closed') {
        transport.close()
      }
    })

    transport.on('closed', () => {
        console.log('Transport closed')
    })
    callback({
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      }
    })
    return transport
  } catch (error) {
    callback: {
      params: {
        error: error
      }
    }
  }
}

io.on('connection', async (socket) => {

  socket.emit('me', {socketId: socket.id})

  socket.on('disconnect', () => {
    console.log(`${socket.id} has disconnected`)
  })

  router = await worker.createRouter({ mediaCodecs })

  socket.on('getRtpCapabilities', (callback) => {
    const rtpCapabilities = router.rtpCapabilities
    console.log('RTP Capabilities', rtpCapabilities)

    callback({ rtpCapabilities })
  })

  socket.on('transport-recv-connect', async ({dtlsParameters}) => {
    console.log('DTLS PARAMS', dtlsParameters)
    await consumerTransport.connect({ dtlsParameters })
  })

  socket.on('consume', async ({ rtpCapabilities }, callback ) => {
    try {
      if (router.canConsume({
        producerId: producer.id,
        rtpCapabilities
      })) {
        consumer = await consumerTransport.consume({
          producerId: producer.id,
          rtpCapabilities,
          paused: true
        })

        consumer.on('transportclose', () => {
          console.log('Transport close from consumer')
        })

        consumer.on('producerclose', () => {
          console.log('Producer of consumer closed')
        })

        const params = {
          id: consumer.id,
          producerId: producer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters
        }
      
        callback({ params })
      }
    } catch (error) {
      console.log(error.message);
      callback({
        params: {
          error: error
        }
      })
    }
  })

  socket.on('consumer-resume', async () => {
    console.log('Consumer resumed')
    await consumer.resume()
  })

  socket.on('createWebRtcTransport', async ({ sender }, callback) => {
    console.log('Is this a sender request', sender)
    if (sender) {
      producerTransport = await createWebRtcTransport(callback)
    } else {
      consumerTransport = await createWebRtcTransport(callback)
    }
  })

  socket.on('transport-connect', async ({ dtlsParameters }) => {
    console.log('DTLS PARAMS', {dtlsParameters})
    await producerTransport.connect({dtlsParameters})
  })

  socket.on('transport-produce', async ({ kind, rtpParameters, appData }, callback ) => {
    producer = await producerTransport.produce({
      kind,
      rtpParameters
    })

    console.log('Producer ID:', producer.id, producer.kind)

    producer.on('transportclose', () => {
      console.log('Transport for this producer is closed')
      producer.close()
    })

    callback({
      id: producer.id
    })
  })

})

const port = process.env.PORT || 3000

server.listen(port, () => {
  console.log(`Server listening at port ${port}`)
})
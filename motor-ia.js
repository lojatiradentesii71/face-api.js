const os = require('os');
const fs = require('fs');
const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

// Carrega as bibliotecas do face-api.js e emuladores de ambiente
const tf = require('@tensorflow/tfjs-node');
const canvas = require('canvas');
const faceapi = require('./dist/face-api.node.js'); // Caminho da biblioteca do seu fork

const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

// CONFIGURAÇÕES DA PLANILHA
const SPREADSHEET_ID = "14_0KTC_EBNcGwke8ND2AgMqGWbh_ohjnHET-MAFqBRw"; // ⚠️ VAMOS AJUSTAR ISSO JÁ JÁ
const ABA_CADASTRO = "CadastradoBio";
const ABA_PRESENCA = "Presenca";
const COLUNA_IRFOTO = 8;

async function iniciar() {
  try {
    console.log("Inicializando Modelos de Inteligência Artificial...");
    // Carrega os pesos matemáticos de reconhecimento facial que já estão na pasta weights do seu fork
    await faceapi.nets.ssdMobilenetv1.loadFromDisk('./weights');
    await faceapi.nets.faceLandmark68Net.loadFromDisk('./weights');
    await faceapi.nets.faceRecognitionNet.loadFromDisk('./weights');

    // Conecta na Planilha Google usando o Segredo do GitHub
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const auth = new GoogleAuth({
      credentials: { client_email: creds.client_email, private_key: creds.private_key },
      scopes: ['https://googleapis.com', 'https://googleapis.com'],
    });

    const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);
    await doc.loadInfo();

    // 1. CARREGA AS FOTOS BASE DE CADASTRO
    console.log("Carregando rostos cadastrados da aba CadastradoBio...");
    const sheetCadastro = doc.sheetsByTitle[ABA_CADASTRO];
    const linhasCadastro = await sheetCadastro.getRows();
    const rostosConhecidos = [];

    for (let linha of linhasCadastro) {
      const nome = linha.get('Nome');
      const urlFoto = linha.get('Foto1'); // Usa a Foto1 como referência principal

      if (urlFoto && urlFoto.startsWith('http')) {
        try {
          const resImg = await axios.get(urlFoto, { responseType: 'arraybuffer' });
          const img = await canvas.loadImage(Buffer.from(resImg.data));
          const descritor = await faceapi.computeFaceDescriptor(img);
          
          if (descritor) {
            rostosConhecidos.push(new faceapi.LabeledFaceDescriptors(nome, [descritor]));
            console.log(Rosto de ${nome} carregado com sucesso.);
          }
        } catch (e) {
          console.log(Erro ao processar cadastro de ${nome}: ${e.message});
        }
      }
    }

    if (rostosConhecidos.length === 0) {
      console.log("Nenhum rosto cadastrado encontrado.");
      return;
    }

    const faceMatcher = new faceapi.FaceMatcher(rostosConhecidos, 0.55);

    // 2. PROCESSA A FOTO ATUAL DA REUNIÃO ENVIADA PELO APPSHEET
    const urlFotoAtual = process.env.FOTO_URL;
    const linhaId = parseInt(process.env.LINHA_ID);
    console.log(Baixando foto da reunião da linha ${linhaId}: ${urlFotoAtual});

    const resAtual = await axios.get(urlFotoAtual, { responseType: 'arraybuffer' });
    const imgAtual = await canvas.loadImage(Buffer.from(resAtual.data));
    
    const deteccoes = await faceapi.detectAllFaces(imgAtual).withFaceLandmarks().withFaceDescriptors();

    const sheetPresenca = doc.sheetsByTitle[ABA_PRESENCA];
    await sheetPresenca.loadCells();

    if (deteccoes.length === 0) {
      console.log("Nenhum rosto detectado na foto da reunião.");
      // Grava aviso na planilha (LinhaId no GoogleSheets começa em 1, mas rows começam em 0)
      sheetPresenca.getCell(linhaId - 1, COLUNA_IRFOTO - 1).value = "Não Reconhecido";
      await sheetPresenca.saveUpdatedCells();
      return;
    }

    // Compara o primeiro rosto encontrado na foto com a nossa galeria
    const melhorMatch = faceMatcher.findBestMatch(deteccoes[0].descriptor);
    console.log(Resultado da comparação: ${melhorMatch.toString()});

    if (melhorMatch.label !== 'unknown') {
      console.log(Sucesso! Pessoa identificada: ${melhorMatch.label});
      sheetPresenca.getCell(linhaId - 1, COLUNA_IRFOTO - 1).value = melhorMatch.label;
    } else {
      sheetPresenca.getCell(linhaId - 1, COLUNA_IRFOTO - 1).value = "Não Reconhecido";
    }

    await sheetPresenca.saveUpdatedCells();
    console.log("Planilha atualizada com sucesso!");

  } catch (erro) {
    console.error("Erro fatal no motor de IA:", erro);
  }
}

iniciar();

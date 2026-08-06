import { Router } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
export const geminiRouter = Router();

const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (apiKey) {
  ai = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
} else {
  console.warn("Aviso: GEMINI_API_KEY não foi encontrada nas variáveis de ambiente. Usando simulador local.");
}

geminiRouter.post("/generate", async (req, res) => {
  const { establishmentType, targetAudience, toneGoal } = req.body;
  
  if (!establishmentType || !targetAudience || !toneGoal) {
    return res.status(400).json({ error: "Missing prompt parameters" });
  }

  // If AI client is not configured, send structured mock directly
  if (!ai) {
    return res.json({
      tickers: [
        `Novidades na rede ${establishmentType}! Promoção exclusiva para nosso público de hoje.`,
        `Fique por dentro! Conheça nossas soluções digitais e melhore seu dia.`,
        `Dica: Dedique 5 minutos do seu dia para respirar fundo e focar no que importa.`
      ],
      campaigns: [
        { name: "Campanha Institucional", duration: 15, idea: "Exibir vídeo conceitual mostrando o cuidado com os detalhes de atendimento." },
        { name: "Campanha Conexão", duration: 10, idea: "Slide colorido instigando o público a interagir com os perfis de mídias sociais." }
      ],
      ctaText: `Marque nosso perfil nas redes sociais usando a nossa hashtag especial!`
    });
  }

  try {
    const prompt = `Crie conteúdo em Português para uma TV Corporativa / Sinalização Digital.
    Tipo do Negócio: ${establishmentType}
    Público-alvo das telas: ${targetAudience}
    Objetivo ou tom do conteúdo: ${toneGoal}
    
    Por favor, retorne os dados estritamente em formato JSON contendo os seguintes campos:
    1. tickers: uma array de 3 frases curtas e cativantes (máximo de 120 caracteres cada) ideais para rodar no letreiro scrolling marquee da TV.
    2. campaigns: uma array com 2 ideias de campanhas/slides de programação, cada uma contendo "name" (string), "duration" (número de segundos recomendados, ex: 10, 15) e "idea" (uma breve descrição de como deve ser o slide visual).
    3. ctaText: uma frase convincente e dinâmica de chamada para ação para colocar no rodapé estimulando o público a seguir o instagram ou baixar o aplicativo do estabelecimento.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "Você é um especialista em Marketing de Sinalização Digital (Digital Signage) e TV Corporativa no Brasil. Escreva textos profissionais, polidos e sem erros gramaticais.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            tickers: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "3 frases curtas e chamativas para o letreiro digital rotativo de rodapé."
            },
            campaigns: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING, description: "Nome comercial da campanha sugerida." },
                  duration: { type: Type.INTEGER, description: "Duração recomendada em segundos." },
                  idea: { type: Type.STRING, description: "Breve explicação do conteúdo visual do slide." }
                },
                required: ["name", "duration", "idea"]
              }
            },
            ctaText: {
              type: Type.STRING,
              description: "Uma frase marcante estimulando ação física ou digital do público."
            }
          },
          required: ["tickers", "campaigns", "ctaText"]
        }
      }
    });

    if (response.text) {
      const parsedData = JSON.parse(response.text.trim());
      res.json(parsedData);
    } else {
      throw new Error("Empty text returned from Gemini API");
    }
  } catch (error: any) {
    console.error("Gemini Generation Error:", error);
    res.status(500).json({ error: "Erro ao gerar ideias com Gemini", details: error.message });
  }
});

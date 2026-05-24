const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const { GoogleGenAI } = require('@google/genai');

// 1. ตั้งค่ากุญแจเชื่อมต่อ (ระบบจะไปอ่านจากค่าความลับบน Server อีกที)
const lineConfig = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const lineClient = new Client(lineConfig);
const app = express();

// 2. ระบบดักฟังข้อความจาก LINE (Webhook)
app.post('/webhook', middleware(lineConfig), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// 3. ฟังก์ชันจัดการเมื่อมีข้อความเข้ากลุ่ม
async function handleEvent(event) {
  // ทำงานเฉพาะตอนที่มีคนพิมพ์ข้อความ (Text) เข้ามาเท่านั้น
  if (event.type !== 'message' || event.message.type !== 'text') {
    return null;
  }

  const userText = event.message.text;
  let isBotMentioned = false;

  // [3.3] เช็กระบบดักคำสั่ง: ตรวจสอบว่าบอทโดนแท็ก (Mention) ในกลุ่มไหม
  if (event.message.mention && event.message.mention.mentions) {
    // ถ้ามีประวัติการแท็กในข้อความ ให้เช็กว่าไอดีตรงกับบอทของเราไหม
    isBotMentioned = event.message.mention.mentions.some(
      mention => mention.isSelf === true || userText.includes('@bot') || userText.includes('บอท')
    );
  } else {
    // เผื่อเพื่อนพิมพ์คำว่า "บอท" หรือ "ai" โต้งๆ โดยไม่ได้กดแท็กสีฟ้า
    if (userText.startsWith('บอท ') || userText.startsWith('ai ') || userText.startsWith('AI ')) {
      isBotMentioned = true;
    }
  }

  // ถ้าบอทไม่ได้โดนเรียก -> นั่งเงียบๆ ปล่อยผ่าน ไม่เสียโควตา API
  if (!isBotMentioned) return null;

  // ตัดคำว่า บอท/ai ออกเพื่อให้เหลือแต่ประโยคคำถามเพียวๆ ส่งให้ AI
  const cleanPrompt = userText.replace(/^(@\S+|บอท|ai|AI)\s*/, '');

  try {
    // ส่งคำถามไปให้ Gemini ประมวลผล พร้อมกับแนบ System Instruction
   // ส่งคำถามไปให้ Gemini ประมวลผล พร้อมกับเปิดใช้ Google Search บルトอิน
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: cleanPrompt,
      config: {
        // [เปิดสิทธิ์ให้ AI ค้นหาอินเทอร์เน็ตได้เหมือนในแอป]
        tools: [{ googleSearch: {} }], 
        
        // [ปรับคำสั่งควบคุมพฤติกรรมเพิ่มความเอะใจ]
        systemInstruction: "คุณคือเพื่อนสนิทในกลุ่มแชทที่เป็นทั้งผู้ช่วยอัจฉริยะและสายตบมุกฮาๆ ในคนเดียวกัน โดยให้คุณปรับโหมดการตอบตามประเภทคำถามดังนี้: 1. [โหมดถามสาระ/ความรู้ทั่วไป]: ให้ใช้ Google Search ค้นหาข้อมูลจริง แล้วสรุปตอบอย่างสุภาพ ชัดเจน สั้นกระชับ ตรงประเด็นทันที ไม่พูดยาวเยิ่นเย้อ 2. [โหมดคุยเล่น/ไร้สาระ]: ให้ตอบกลับอย่างเป็นกันเอง สนุกสนาน ใช้ภาษาวัยรุ่นกวนๆ เล็กน้อย 3. [โหมดดักทางสถานที่เที่ยว/คำสแลง]: หากผู้ใช้ถามถึงสถานที่ ร้านค้า หรือคำแปลกๆ แล้ว Google Search ค้นเจอว่าเป็นสถานบันเทิง ร้านเหล้า หรืออาบอบนวด/นวดแผนโบราณ ให้ข้ามเรื่องสาระแล้วตบมุกแซวแรงทันที เช่น 'เดอะแบงค์หรอ? สามีเธอจะไปเปิดบัญชี VIP หรือไปกินสุกี้หม้อรวมรึป่าว มันเป็นอาบอบนวด / Massage Club Entertainment นะแก!' เน้นตอบกระชับ ไม่เยิ่นเย้อ"
      }
    });

    const replyText = response.text;

    // ส่งคำตอบจาก AI สวนกลับเข้าไปในแชทกลุ่ม LINE
    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: replyText
    });

  } catch (error) {
    console.error('AI Error:', error);
    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: 'โฮสต์ระเบิด แป๊บนะเพื่อน...'
    });
  }
}

// เปิดพอร์ตเซิร์ฟเวอร์
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
---
version: 1.0
updatedAt: 2026-11-21
---
# AI and ML Services: SageMaker AI, the Prebuilt AI Services and Amazon Q

> Exam domain: **Cloud Technology and Services (34%)**, task statement 3.7 *Identify AI/ML services and analytics services* (AI/ML half).

---

## What the exam wants

The guide asks you to name AI/ML services **and the tasks they do**, with Amazon SageMaker AI and Amazon Lex as examples. The in-scope machine learning list is short: **Comprehend, Lex, Polly, Amazon Q, Rekognition, SageMaker AI, Textract, Transcribe, Translate**. Questions are almost always "which service does this task?". One verb, one service.

---

## Two families: build your own model or call a ready one

```text
 Do you need YOUR OWN model trained on your data?
   yes -> Amazon SageMaker AI (build, train, deploy)
   no  -> a prebuilt AI service: send data through an API, get a result
          (no ML expertise, no training, no servers)
```

| | Amazon SageMaker AI | Prebuilt AI services |
|---|---|---|
| Who uses it | Data scientists and developers building models | Any developer calling an API |
| What you do | Prepare data, train, tune and deploy a model to a hosted endpoint | Send text, audio, images or documents and get a prediction |
| ML skills needed | Yes (or SageMaker Canvas for no-code predictions) | No |
| Typical stem | "Train a custom model to predict equipment failure" | "Detect faces in uploaded photos" |

**SageMaker Canvas** lets business analysts generate ML predictions (churn, inventory, pricing) without writing code. It is still part of SageMaker AI.

> Older study material says "Amazon SageMaker". The exam guide and the current documentation call the ML service **Amazon SageMaker AI**. Same purpose: build, train and deploy ML models.

---

## The verb map

| The stem says | Service | Input to output |
|---------------|---------|-----------------|
| Find objects, scenes, text, unsafe content or compare faces in images and video | **Amazon Rekognition** | Image or video to labels |
| Pull printed text, handwriting, forms, tables from scanned documents | **Amazon Textract** | Document image to structured data |
| Find sentiment, entities, key phrases, language or topics in text | **Amazon Comprehend** | Text to insights (NLP) |
| Convert speech to text (call recordings, subtitles) | **Amazon Transcribe** | Audio to text |
| Convert text to lifelike speech (audio versions of articles, voice prompts) | **Amazon Polly** | Text to audio |
| Translate text between languages | **Amazon Translate** | Text to text in another language |
| Build a chatbot or voice bot that understands intent | **Amazon Lex** | Conversation (voice or text) |
| A generative AI assistant that answers questions and helps build and operate on AWS | **Amazon Q** | Question to generated answer |

Pairs that the exam swaps on purpose:

- **Transcribe vs Polly**: Transcribe listens (speech to text), Polly speaks (text to speech).
- **Textract vs Rekognition**: Textract reads documents and forms, Rekognition looks at photos and video. Rekognition can spot text in an image, but a form with fields and tables is Textract.
- **Comprehend vs Translate**: Comprehend understands what text means (sentiment), Translate changes its language.
- **Lex vs Polly**: Lex holds the conversation (it includes speech recognition and language understanding), Polly only turns text into a voice. A call-center bot often combines both.

---

## A typical pipeline

```text
 Customer call recording
   -> Amazon Transcribe   (speech to text)
   -> Amazon Translate    (Spanish to English)
   -> Amazon Comprehend   (negative sentiment? which product?)
   -> dashboard or ticket
```

Expect questions that ask for the service at one step of a chain like this. Name the step's verb and pick the matching service.

---

## Amazon Q

- **Amazon Q Developer** is a generative AI conversational assistant that helps you understand, build, extend and operate AWS applications. It is built on Amazon Bedrock.
- In the Management Console its chat is now called the "AWS assistant", and AWS has announced the end of support for the Q Developer IDE plugins on April 30, 2027, pointing developers to Kiro (as of 2026-11-21).
- **Amazon Q Business** is no longer open to new customers, and AWS points those users to Amazon Quick (lesson 4-4). For the exam, know Amazon Q as **AWS's generative AI assistant**, not the sub-brands.

---

## Generative AI terms (supporting only)

The exam guide does not name any generative AI concept. These short definitions, from AWS's own explainer pages, help you read a stem; they are not a study target.

| Term | Meaning |
|------|---------|
| Generative AI | AI that creates new content: conversations, stories, images, video, music |
| Foundation model | A large deep learning network trained on massive data, used as a starting point instead of training from scratch |
| Large language model (LLM) | A very large deep learning model pre-trained on vast text, built on transformers |
| Prompt engineering | Guiding a generative model to the output you want through the wording and format of the request |
| Retrieval-augmented generation (RAG) | Making the model consult an authoritative knowledge base outside its training data before it answers |

> Not named in the exam guide: **Amazon Bedrock**, a managed service that gives access to foundation models from Amazon and other AI companies through one API. Amazon Kendra (enterprise search) is closed to new customers. Amazon Personalize (recommendations) is out of scope.

---

## Watch out

- **Custom model means SageMaker AI; a ready task means the prebuilt service.** "Train", "tune", "deploy our model" point to SageMaker AI.
- **Listen vs speak.** Speech to text is Transcribe; text to speech is Polly.
- **Comprehend does not do speech.** It analyzes text that already exists.
- **Lex is the chatbot, not Polly.** Polly has no understanding of intent.
- **Forms and tables in scanned documents are Textract,** not Rekognition and not Comprehend.
- **Recognize gen AI by the task.** If the stem asks for an assistant that answers questions and generates code or explanations about AWS, it is Amazon Q.
- **Use the guide's names.** Amazon SageMaker AI (not "Amazon SageMaker") and Amazon Q.

## Quick check

1. A news site wants audio versions of every article. **Amazon Polly.**
2. A bank wants the fields from scanned loan applications as structured data. **Amazon Textract.**
3. A retailer wants to know if product reviews are positive or negative. **Amazon Comprehend.**
4. Data scientists need managed infrastructure to train and host their own model. **Amazon SageMaker AI.**
5. An airline wants a chatbot that books flights by voice or text. **Amazon Lex.**

## Official documentation

- [What is Amazon SageMaker AI](https://docs.aws.amazon.com/sagemaker/latest/dg/whatis.html)
- [Amazon Rekognition](https://docs.aws.amazon.com/rekognition/latest/dg/what-is.html)
- [Amazon Textract](https://docs.aws.amazon.com/textract/latest/dg/what-is.html)
- [Amazon Comprehend](https://docs.aws.amazon.com/comprehend/latest/dg/what-is.html)
- [Amazon Lex V2](https://docs.aws.amazon.com/lexv2/latest/dg/what-is.html)
- [Amazon Transcribe](https://docs.aws.amazon.com/transcribe/latest/dg/what-is.html)
- [What is Amazon Q Developer](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/what-is.html)
- [What is generative AI](https://aws.amazon.com/what-is/generative-ai/)

---
version: 1.0
updatedAt: 2026-11-21
---
# Serviços de IA e ML: SageMaker AI, os serviços de IA prontos e o Amazon Q

> Domínio do exame: **Tecnologia e serviços de nuvem (34%)**, objetivo 3.7 *Identificar os serviços de IA/ML e os serviços de análise de dados* (parte de IA/ML).

---

## O que o exame cobra

O guia pede que você nomeie os serviços de IA/ML **e as tarefas que eles executam**, com o Amazon SageMaker AI e o Amazon Lex como exemplos. A lista de machine learning no escopo é curta: **Comprehend, Lex, Polly, Amazon Q, Rekognition, SageMaker AI, Textract, Transcribe, Translate**. As questões quase sempre são "qual serviço faz esta tarefa?". Um verbo, um serviço.

---

## Duas famílias: construir o seu próprio modelo ou chamar um modelo pronto

```text
 Você precisa de um modelo PRÓPRIO treinado com os seus dados?
   sim -> Amazon SageMaker AI (construir, treinar, implantar)
   não -> um serviço de IA pronto: envie dados por uma API, receba um resultado
          (sem conhecimento de ML, sem treinamento, sem servidores)
```

| | Amazon SageMaker AI | Serviços de IA prontos |
|---|---|---|
| Quem usa | Cientistas de dados e desenvolvedores que constroem modelos | Qualquer desenvolvedor que chama uma API |
| O que você faz | Prepara os dados, treina, ajusta e implanta um modelo em um endpoint hospedado | Envia texto, áudio, imagens ou documentos e recebe uma previsão |
| Conhecimento de ML necessário | Sim (ou SageMaker Canvas para previsões sem código) | Não |
| Enunciado típico | "Treinar um modelo personalizado para prever falhas de equipamentos" | "Detectar rostos em fotos enviadas" |

O **SageMaker Canvas** permite que analistas de negócios gerem previsões de ML (churn, estoque, preços) sem escrever código. Ele continua sendo parte do SageMaker AI.

> Material de estudo antigo diz "Amazon SageMaker". O guia do exame e a documentação atual chamam o serviço de ML de **Amazon SageMaker AI**. Mesma finalidade: construir, treinar e implantar modelos de ML.

---

## O mapa de verbos

| O enunciado diz | Serviço | Da entrada à saída |
|-----------------|---------|--------------------|
| Encontrar objetos, cenas, texto, conteúdo impróprio ou comparar rostos em imagens e vídeo | **Amazon Rekognition** | Imagem ou vídeo para rótulos |
| Extrair texto impresso, escrita à mão, formulários e tabelas de documentos digitalizados | **Amazon Textract** | Imagem de documento para dados estruturados |
| Encontrar sentimento, entidades, frases-chave, idioma ou tópicos em texto | **Amazon Comprehend** | Texto para insights (NLP) |
| Converter fala em texto (gravações de chamadas, legendas) | **Amazon Transcribe** | Áudio para texto |
| Converter texto em fala realista (versões em áudio de artigos, prompts de voz) | **Amazon Polly** | Texto para áudio |
| Traduzir texto entre idiomas | **Amazon Translate** | Texto para texto em outro idioma |
| Criar um chatbot ou bot de voz que entende a intenção | **Amazon Lex** | Conversa (voz ou texto) |
| Um assistente de IA generativa que responde perguntas e ajuda a criar e operar na AWS | **Amazon Q** | Pergunta para resposta gerada |

Pares que o exame troca de propósito:

- **Transcribe vs Polly**: o Transcribe escuta (fala para texto), o Polly fala (texto para fala).
- **Textract vs Rekognition**: o Textract lê documentos e formulários, o Rekognition olha fotos e vídeo. O Rekognition consegue identificar texto em uma imagem, mas um formulário com campos e tabelas é Textract.
- **Comprehend vs Translate**: o Comprehend entende o que o texto significa (sentimento), o Translate muda o idioma dele.
- **Lex vs Polly**: o Lex conduz a conversa (inclui reconhecimento de fala e compreensão de linguagem), o Polly apenas transforma texto em voz. Um bot de central de atendimento costuma combinar os dois.

---

## Um pipeline típico

```text
 Gravação de uma chamada de cliente
   -> Amazon Transcribe   (fala para texto)
   -> Amazon Translate    (espanhol para inglês)
   -> Amazon Comprehend   (sentimento negativo? qual produto?)
   -> painel ou ticket
```

Espere questões que pedem o serviço em uma etapa de uma cadeia como esta. Identifique o verbo da etapa e escolha o serviço correspondente.

---

## Amazon Q

- O **Amazon Q Developer** é um assistente conversacional de IA generativa que ajuda você a entender, criar, ampliar e operar aplicações na AWS. Ele é construído sobre o Amazon Bedrock.
- No Management Console, o chat dele agora se chama "AWS assistant", e a AWS anunciou o fim do suporte aos plugins de IDE do Q Developer em 30 de abril de 2027, indicando o Kiro aos desenvolvedores (em 21/11/2026).
- O **Amazon Q Business** não está mais aberto a novos clientes, e a AWS indica o Amazon Quick a esses usuários (lição 4-4). Para o exame, conheça o Amazon Q como o **assistente de IA generativa da AWS**, não as submarcas.

---

## Termos de IA generativa (apenas apoio)

O guia do exame não cita nenhum conceito de IA generativa. Estas definições curtas, vindas das próprias páginas explicativas da AWS, ajudam a ler um enunciado; não são um alvo de estudo.

| Termo | Significado |
|-------|-------------|
| IA generativa | IA que cria conteúdo novo: conversas, histórias, imagens, vídeo, música |
| Modelo de fundação (foundation model) | Uma grande rede de deep learning treinada com dados massivos, usada como ponto de partida em vez de treinar do zero |
| Modelo de linguagem grande (LLM) | Um modelo de deep learning muito grande, pré-treinado com vastas quantidades de texto, construído sobre transformers |
| Engenharia de prompts | Orientar um modelo generativo até a saída desejada por meio da redação e do formato da solicitação |
| Geração aumentada por recuperação (RAG) | Fazer o modelo consultar uma base de conhecimento confiável fora dos seus dados de treinamento antes de responder |

> Não citado no guia do exame: o **Amazon Bedrock**, um serviço gerenciado que dá acesso a modelos de fundação da Amazon e de outras empresas de IA por meio de uma única API. O Amazon Kendra (busca corporativa) está fechado a novos clientes. O Amazon Personalize (recomendações) está fora do escopo.

---

## Atenção

- **Modelo personalizado indica SageMaker AI; uma tarefa pronta indica o serviço pronto.** "Treinar", "ajustar", "implantar o nosso modelo" apontam para o SageMaker AI.
- **Escutar vs falar.** Fala para texto é Transcribe; texto para fala é Polly.
- **O Comprehend não trabalha com fala.** Ele analisa texto que já existe.
- **Lex é o chatbot, não o Polly.** O Polly não entende a intenção.
- **Formulários e tabelas em documentos digitalizados são Textract,** não Rekognition e não Comprehend.
- **Reconheça a IA generativa pela tarefa.** Se o enunciado pede um assistente que responde perguntas e gera código ou explicações sobre a AWS, é o Amazon Q.
- **Use os nomes do guia.** Amazon SageMaker AI (não "Amazon SageMaker") e Amazon Q.

## Verificação rápida

1. Um site de notícias quer versões em áudio de todos os artigos. **Amazon Polly.**
2. Um banco quer os campos de pedidos de empréstimo digitalizados como dados estruturados. **Amazon Textract.**
3. Uma varejista quer saber se as avaliações de produtos são positivas ou negativas. **Amazon Comprehend.**
4. Cientistas de dados precisam de infraestrutura gerenciada para treinar e hospedar o próprio modelo. **Amazon SageMaker AI.**
5. Uma companhia aérea quer um chatbot que reserva voos por voz ou texto. **Amazon Lex.**

## Documentação oficial

- [What is Amazon SageMaker AI](https://docs.aws.amazon.com/sagemaker/latest/dg/whatis.html)
- [Amazon Rekognition](https://docs.aws.amazon.com/rekognition/latest/dg/what-is.html)
- [Amazon Textract](https://docs.aws.amazon.com/textract/latest/dg/what-is.html)
- [Amazon Comprehend](https://docs.aws.amazon.com/comprehend/latest/dg/what-is.html)
- [Amazon Lex V2](https://docs.aws.amazon.com/lexv2/latest/dg/what-is.html)
- [Amazon Transcribe](https://docs.aws.amazon.com/transcribe/latest/dg/what-is.html)
- [What is Amazon Q Developer](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/what-is.html)
- [What is generative AI](https://aws.amazon.com/what-is/generative-ai/)

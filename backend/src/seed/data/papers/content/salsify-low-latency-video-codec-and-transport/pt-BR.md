---
title: "Salsify: vídeo de rede com baixa latência por meio de uma integração mais estreita entre codec de vídeo e protocolo de transporte"
summary: Um sistema de vídeo em tempo real que funde o controle de taxa do codec e o controle de congestionamento do transporte em um só laço, escolhendo para cada quadro uma codificação que cabe no que a rede aguenta naquele momento.
researchArea: Redes de computadores
keywords: vídeo em tempo real, baixa latência, controle de congestionamento, codec de vídeo, webrtc, vp8
version: 1.0
updatedAt: 2026-10-31
---

## Visão geral

As chamadas de vídeo pela Internet são montadas com dois módulos, cada um com seu próprio laço de controle. O protocolo de transporte observa confirmações e congestionamento e estima a capacidade do caminho. O codec de vídeo escolhe uma taxa de quadros e uma qualidade para que sua taxa de bits média acompanhe essa estimativa. Na implementação de referência do WebRTC, o transporte atualiza o codificador cerca de uma vez por segundo.

A fraqueza é a diferença de escalas de tempo. Um enlace celular pode mudar muito mais rápido do que o codificador se ajusta, e um único quadro que ultrapassa a capacidade do caminho é enviado mesmo assim, enchendo um buffer ou sendo descartado. O sistema então manda o codificador pausar até a situação se resolver. Este artigo do NSDI 2018, de Stanford, defende que os dois laços devem ser um só.

## Contribuição

O Salsify é um projeto em que o codec e o transporte compartilham um único algoritmo de controle, com uma interface limpa entre eles.

- **Um transporte que entende vídeo.** Sua estimativa de capacidade se baseia no Sprout-EWMA e leva em conta que um codificador de vídeo envia dados em rajadas do tamanho de quadros, e não em "potência máxima", como muitas avaliações de transporte supõem.
- **Um codec puramente funcional.** O codificador e o decodificador VP8 (cerca de 11 mil linhas de C++) não guardam estado escondido: a aplicação passa o estado e o recebe de volta, com `encode(state, image, quality)` e `decode(state, frame)`. Em 720p o estado tem cerca de 4 MiB. Como codificar não tem efeitos colaterais, o emissor pode testar várias codificações de um quadro e ficar com uma.
- **Uma escolha por quadro.** Para cada quadro o emissor codifica com duas configurações de qualidade a partir do mesmo estado, espera saber os tamanhos reais e envia a que melhor combina com a estimativa atual de capacidade da rede, ou não envia nenhuma e pula o quadro.
- **Recuperação de perdas escolhendo o estado de origem.** Depois de uma perda, o emissor codifica os próximos quadros em relação a um estado que o receptor confirmou, de modo que possam ser decodificados mesmo que os pacotes do meio tenham se perdido. Os autores relacionam isso à "retransmissão profilática" do Mosh.
- **Uma bancada de testes para sistemas de caixa-preta**, descrita abaixo, e o código e os dados liberados como código aberto.

## Metodologia

A bancada parece, do lado do emissor, uma webcam USB tocando um trecho fixo e, do lado do receptor, captura a saída HDMI da tela. Assim ela mede o atraso e a qualidade de cada quadro de ponta a ponta, e aplicativos comerciais podem ser comparados sem serem instrumentados. Os caminhos de rede são emulados reproduzindo os tempos de pacotes gravados em redes celulares.

O Salsify (com as duas codificações feitas em série em um núcleo, ou em paralelo em dois) é comparado com o FaceTime, o Hangouts, o Skype e a implementação de referência do WebRTC no Chrome, com e sem codificação de vídeo escalável VP9. A qualidade é medida pelo índice de similaridade estrutural (SSIM). Dois estudos com usuários, um bate-papo por vídeo e um jogo de direção, calibram o quanto atraso e qualidade importam para quem usa.

## Resultados

Estes são os resultados relatados pelos autores.

- Em um caminho AT&T LTE emulado, o Salsify de um núcleo teve atraso de vídeo no percentil 95 de 449 ms e SSIM de 15,4 dB. Todos os outros sistemas foram piores nos dois pontos. O atraso deles foi maior em 1,2 vez (Skype), 2,3 vezes (FaceTime), 4,2 vezes (Hangouts), 7,9 vezes (WebRTC com VP9-SVC) e 10,5 vezes (WebRTC), e o SSIM, menor em 1,3 a 6,9 dB.
- O sistema vence pelo projeto e não pelo codec: o Salsify usa um codec VP8 finalizado em 2008 e um codificador pouco sofisticado, e mesmo assim produziu melhor qualidade. Os autores leem isso como sinal de que melhorias só nos codecs chegaram a retornos decrescentes nesse cenário, enquanto mudanças na arquitetura dos sistemas de vídeo ainda podem trazer muito.
- Nesse cenário de um para um, o WebRTC com codificação de vídeo escalável VP9 não melhorou de forma marcante em relação ao WebRTC convencional.

## Análise crítica

Os autores listam limites que importam.

- **Exige um codec que exponha seu estado.** Codecs convencionais, em software ou hardware, não fazem isso, e em dispositivos com restrição de energia só os codecs em hardware são eficientes o bastante. Se os codecs comuns aprenderem a atingir um tamanho de quadro alvo, a vantagem de um codec funcional diminui.
- **Mais forte em caminhos variáveis.** Os ganhos são maiores em enlaces que mudam rápido, como os celulares em movimento, e ficam mais próximos dos outros sistemas em redes mais estáveis.
- **Uma comparação estreita.** Só foi testado vídeo em um sentido, sem áudio, sem tráfego concorrente na mesma fila do gargalo e sem caminhos do mundo real. Os sistemas comerciais foram medidos em 2018 e mudaram desde então.
- **Só unicast.** O Salsify mira um emissor e um receptor. Uma chamada repassada por uma SFU precisa atender a vários receptores com caminhos diferentes a partir de uma só codificação, e é aí que o vídeo em camadas, em que o repassador descarta camadas sem recodificar, é atraente. O próprio artigo observa esse uso da codificação escalável e não o trata.

## Pesquisas futuras

- Fazer os codecs, principalmente os de hardware, exporem e restaurarem seu estado, como os autores esperam.
- Acrescentar áudio e mantê-lo sincronizado com o vídeo no menor atraso possível.
- Chamadas com vários fluxos, nos dois sentidos, e com mais de dois participantes.
- Combinar a abordagem por quadro com vídeo em camadas, em que um servidor encaminha os fluxos.

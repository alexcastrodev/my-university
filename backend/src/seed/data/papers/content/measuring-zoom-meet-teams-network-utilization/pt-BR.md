---
title: "Medindo o desempenho e a utilização de rede de aplicativos populares de videoconferência"
summary: Uma medição em laboratório do Zoom, do Google Meet e do Microsoft Teams sob condições de rede controladas, mostrando quanta banda cada um precisa, com que rapidez se recupera de uma queda, como compete e como o layout da tela muda o tráfego.
researchArea: Redes de computadores
keywords: videoconferência, zoom, google meet, microsoft teams, controle de congestionamento, medição de redes
version: 1.0
updatedAt: 2026-10-31
---

## Visão geral

Quando escolas e empresas passaram para o online em 2020, os aplicativos de videoconferência (VCAs, de video conferencing applications) viraram uma carga para a qual as redes não estavam dimensionadas. Este artigo do IMC 2021, da Universidade de Chicago, nasceu de uma pergunta feita aos autores pelos gestores da própria cidade: que nível de conectividade as pessoas precisam para que essas ferramentas funcionem bem? Ele também surgiu quando a Comissão Federal de Comunicações dos EUA (FCC) debatia o que conta como "banda larga" (na época, 25 Mbps de download e 3 Mbps de upload).

O artigo mede três serviços usados por milhões de pessoas e cujos protocolos são proprietários: Zoom, Google Meet e Microsoft Teams. Como o interior desses sistemas é fechado, ele os trata como caixas-pretas e mede o que fazem na rede e nas estatísticas de WebRTC do navegador.

## Contribuição

Uma comparação lado a lado dos três aplicativos em quatro perguntas:

- Quanta banda de subida e de descida uma chamada precisa, e o que acontece quando o enlace é menor que isso?
- Como uma chamada reage a uma queda temporária de capacidade, e quanto tempo leva para voltar ao normal?
- Como uma chamada divide o enlace com outra chamada, com outro aplicativo ou com uma transferência TCP em massa?
- Como o número de participantes e o modo de visualização (visão de orador, galeria, um vídeo fixado) mudam o tráfego?

Depois ele tira uma conclusão de política pública dos números: uma linha de 25/3 Mbps pode não bastar para duas chamadas simultâneas.

## Metodologia

A montagem usa dois notebooks idênticos (Ubuntu 20.04) ligados por cabo a um roteador com um enlace de Internet dedicado de 1 Gbps simétrico. O controle de tráfego do Linux limita o enlace à capacidade em teste. Para manter o conteúdo igual em todas as execuções, a câmera é trocada por um vídeo gravado de 720p, de uma pessoa falando, enviado pelo ffmpeg, e os passos dentro da chamada são automatizados com o PyAutoGUI. Os aplicativos e as versões são fixos: Chrome 89 para o Meet, cliente Zoom 5.6.1 e cliente Teams 1.4.

- **Condições estáticas.** Chamadas de 2,5 minutos, cinco repetições cada, com o enlace limitado de 0,3 Mbps a 10 Mbps em cada sentido.
- **Interrupções.** Um corte temporário do enlace para 0,25 Mbps e depois o tempo até a taxa voltar ao valor normal.
- **Competição.** Uma segunda chamada, outro aplicativo ou um fluxo TCP do iPerf3 divide o gargalo.
- **Modalidade.** Chamadas com mais participantes e diferentes modos de visualização.

A qualidade do vídeo dentro do navegador é lida das estatísticas do WebRTC: largura do quadro, parâmetro de quantização e travamentos.

## Resultados

Estes são os resultados relatados pelos autores.

- Em um enlace sem limitação, a utilização média dos três aplicativos varia entre 0,8 e 1,9 Mbps. Com um enlace de subida de 10 Mbps, o uso médio de subida foi de 1,44 Mbps no cliente de desktop do Teams, 0,95 no Meet e 0,77 no Zoom.
- Depois de um corte severo da subida para 0,25 Mbps, os três precisaram de mais de 25 segundos para se recuperar, e alguns de até 50 segundos. O Teams também foi lento para se recuperar de quedas na capacidade de descida e piorou até com uma redução moderada para 1 Mbps.
- A competição é desigual. Em cenários com banda limitada, uma chamada de Zoom pode ficar com mais de 75% da banda disponível ao competir com outro aplicativo, como o Meet ou o Teams.
- Mais participantes nem sempre significam mais tráfego. Em alguns aplicativos o uso de um cliente cai à medida que a chamada cresce, porque o vídeo de cada pessoa é exibido, e portanto enviado, em resolução menor.
- O modo de visualização de um participante, como fixar um orador, pode mudar o tráfego de subida dos outros participantes.
- O desempenho começa a piorar abaixo de cerca de 1,5 Mbps de capacidade de subida, e alguns aplicativos não competem bem com fluxos TCP quando o enlace é limitado.

## Análise crítica

É um estudo de medição cuidadoso, e a montagem é honesta quanto aos seus limites.

- **Uma fotografia.** Os números pertencem a versões específicas dos clientes no início de 2021. Esses aplicativos mudam com frequência, então os valores servem mais como exemplo do método do que como requisitos atuais.
- **Controlado, portanto estreito.** Dois notebooks com cabo, um enlace limitado e um vídeo repetido de uma pessoa falando são repetíveis, mas mais simples que chamadas reais, que têm mais movimento, enlaces sem fio, celulares e muitos participantes. O layout de um dos clientes no Linux mostra no máximo quatro pessoas, o que limita o que uma chamada maior pode revelar.
- **As causas são inferidas.** Os autores ligam as diferenças ao controle de congestionamento, à codificação e a como o servidor de repasse de cada serviço adapta os fluxos (qualidades separadas ou vídeo em camadas que o servidor encaminha seletivamente, que é o trabalho de uma SFU). Eles não enxergam o interior dos serviços e apontam comportamentos que não sabem explicar, como uma mudança no parâmetro de quantização em 0,3 Mbps no Meet.
- **Do laboratório à política.** O argumento para mudar a definição de banda larga se apoia em três aplicativos medidos em laboratório. É um dado útil, não um modelo completo da demanda das residências.

## Pesquisas futuras

- Mais aplicativos, plataformas (celulares em particular) e tipos de degradação da rede, como perda e atraso variável, como os autores sugerem.
- Reuniões maiores, em que o servidor de repasse e sua escolha de camadas importam mais que os clientes.
- Medir diretamente o lado dos servidores, para que as causas das diferenças sejam observadas e não adivinhadas. Os dois artigos sobre o formato de pacotes do Zoom e sobre o Scallop, em Papers, vão nessa direção.

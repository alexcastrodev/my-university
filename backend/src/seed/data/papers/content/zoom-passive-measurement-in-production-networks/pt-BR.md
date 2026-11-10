---
title: "Medição passiva do desempenho do Zoom em redes de produção"
summary: Os autores descobrem quais partes dos pacotes proprietários do Zoom são legíveis e as usam para medir taxa de bits, taxa de quadros, latência e jitter só a partir de uma captura de pacotes, sem tocar nos clientes nem nos servidores.
researchArea: Redes de computadores
keywords: zoom, análise de pacotes, medição passiva, rtp, sfu, videoconferência
version: 1.0
updatedAt: 2026-10-31
---

## Resumo

Aplicativos de videoconferência impõem cargas altas e requisitos rigorosos de desempenho à rede. Para entender e gerenciar melhor esses aplicativos, precisamos de formas eficazes de medir o desempenho em uso real. Por exemplo, essas medições ajudariam operadores de rede no planejamento de capacidade, na resolução de problemas e na definição de políticas de QoS. Infelizmente, medições em larga escala de redes de produção não podem depender da cooperação dos dispositivos finais, e uma análise aprofundada de traços de pacotes exige conhecimento dos formatos de cabeçalho. O Zoom é um dos aplicativos mais sofisticados e populares, mas usa um protocolo de rede proprietário. Neste artigo, desvendamos como o Zoom funciona no nível dos pacotes e projetamos técnicas para analisar o desempenho do Zoom a partir de traços de pacotes. Conduzimos experimentos controlados sistemáticos para descobrir os campos relevantes sem criptografia nos pacotes do Zoom, além de como agrupar fluxos em reuniões e como identificar reuniões ponto a ponto. Mostramos como usar os campos de cabeçalho para calcular métricas como taxas de bits de mídia, tamanhos e taxas de quadros, latência e jitter, e demonstramos o valor dessas métricas detalhadas em um traço de 12 horas de tráfego do Zoom na rede do nosso campus.

## Visão geral

Um campus ou um provedor de Internet que quer saber como vão as chamadas de vídeo não pode perguntar aos clientes, e os dados de chamadas que um fornecedor oferece pela sua API são grosseiros. Olhar os pacotes é a alternativa, mas o Zoom usa um protocolo proprietário e criptografa a mídia, de modo que uma captura de pacotes de uma chamada parece ruído para ferramentas como o Wireshark. Estudos anteriores tinham de se contentar com totais por fluxo, e o formato de pacote que descreveram já havia mudado nas capturas de 2021 e 2022 deste estudo.

Este artigo do IMC 2022, de Princeton, faz engenharia reversa das partes legíveis dos pacotes do Zoom e constrói medições sobre elas. É também a base do artigo do Scallop, do mesmo grupo, em Papers.

## Contribuição

- **A estrutura dos pacotes do Zoom.** O Zoom envolve RTP e RTCP padrão em cabeçalhos próprios. Um byte de tipo diz se o pacote é de mídia, de que tipo (áudio, vídeo, compartilhamento de tela) e onde começa o cabeçalho RTP. Os servidores acrescentam mais uma camada, com a direção de ida e volta do servidor.
- **Indício de uma SFU.** O campo do RTP que conta as fontes contribuintes é sempre zero, então cada pacote carrega uma única fonte. Isso sugere que os servidores encaminham os fluxos e não os misturam nem os transcodificam, que é como se comporta uma unidade de encaminhamento seletivo.
- **Detecção de ponto a ponto.** Reuniões de duas pessoas passam a uma conexão direta, que os autores conseguem encontrar pela troca de STUN que a estabelece.
- **Agrupar fluxos em reuniões.** Não há identificador de reunião nos cabeçalhos, então uma heurística casa cópias de um fluxo pelo SSRC e pelos carimbos de tempo do RTP. Funciona porque a SFU do Zoom não reescreve os carimbos de tempo nem os números de sequência do RTP.
- **Métricas.** Taxa de bits por mídia, tamanho e taxa de quadros, latência, jitter e atraso de quadro, calculados só a partir de campos de cabeçalho.
- **Um plugin do Wireshark** e outras ferramentas, liberados como código aberto.

## Metodologia

Os autores fazem chamadas controladas e procuram estrutura nos bytes. Para cada posição do pacote, desenham os valores ao longo de um fluxo: linhas horizontais provavelmente são identificadores, linhas diagonais são contadores ou números de sequência, e uma distribuição uniforme é criptografada. Isso separa os cabeçalhos legíveis da carga.

As métricas são conferidas com as estatísticas do próprio Zoom, lidas por um cliente próprio construído sobre o SDK do Zoom para macOS, que atualiza cerca de uma vez por segundo. As técnicas são então aplicadas a um traço de pacotes de 12 horas de tráfego do Zoom na rede do campus. O traço foi anonimizado, as cargas de mídia foram removidas antes de os pesquisadores o verem, e o estudo passou pela revisão de ética da instituição.

## Resultados

Estes são os resultados relatados pelos autores.

- A taxa de quadros pode ser calculada de duas formas, a partir de um campo de cabeçalho com o número de pacotes de um quadro ou dos passos do carimbo de tempo do RTP, e os autores calibram a segunda pela primeira.
- A latência até o servidor, e entre dois participantes do campus através do servidor, pode ser estimada quando o monitor vê um fluxo ir à SFU e voltar como cópia para outro participante do campus. A SFU do Zoom mantém os valores do RTP, então a cópia é reconhecível.
- O jitter por quadro calculado a partir dos pacotes não coincide com o valor de jitter do próprio Zoom, principalmente durante congestionamento. Os autores dizem que isso os surpreendeu e sugerem que o número do aplicativo pode incluir correção de erros adiante (FEC) ou um intervalo de suavização longo.
- O Zoom retransmite pacotes perdidos até duas vezes, então a perda aparece como duplicatas e não como pacotes ausentes. Cerca de 10% dos pacotes UDP do Zoom não carregam mídia.

## Análise crítica

O valor do artigo está na técnica, e os autores deixam claro que um estudo completo de desempenho do Zoom fica para depois.

- **Frágil por natureza.** O trabalho depende de um formato não documentado que o Zoom pode mudar quando quiser, e que já havia mudado desde os estudos anteriores. Os métodos podem ser refeitos, mas as tabelas de campos têm prazo de validade.
- **Um só ponto de observação.** Um monitor passivo em um campus vê só os participantes daquele campus. Quem está na chamada mas com microfone e câmera desligados não envia nada e fica invisível, então os tamanhos de reunião são estimativas.
- **Perda é difícil de ler.** Por causa das retransmissões, um pacote novo e uma cópia retransmitida não podem ser distinguidos com certeza, então perda e reordenação a partir dos números de sequência são inexatas.
- **Sem verdade de referência para reuniões.** A heurística de agrupamento não tem um identificador de reunião contra o qual conferir.
- **A generalidade é argumentada, não demonstrada.** Os autores esperam que as métricas valham para outros serviços baseados em RTP, como Meet, Teams, Webex e FaceTime, mas só o Zoom é testado.

## Pesquisas futuras

- Rodar as mesmas medições em taxa de linha em um switch programável, que também poderia agir sobre elas, por exemplo encaminhando só algumas camadas de um fluxo em camadas. O artigo do Scallop, em Papers, segue esse caminho.
- Usar as métricas como atributos para prever a qualidade da experiência, com rótulos coletados de espectadores.
- Detectar travamentos comparando o atraso de quadro com o tempo que o quadro cobre.
- Aplicar a mesma abordagem a outros protocolos proprietários.

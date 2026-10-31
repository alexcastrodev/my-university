---
title: "Tambur: recuperação eficiente de perdas em videoconferência com streaming codes"
summary: Uma forma de proteger chamadas de vídeo entre duas pessoas contra rajadas de perda de pacotes, enviando paridade junto de cada quadro para que ela seja usada enquanto os quadros ainda têm tempo de ser exibidos, com a quantidade de redundância ajustada por um pequeno modelo aprendido.
researchArea: Redes de computadores
keywords: videoconferência, correção de erros adiante, streaming codes, perda em rajadas, travamentos de vídeo, qualidade de experiência
version: 1.0
updatedAt: 2026-10-31
---

## Visão geral

Uma chamada de vídeo tem cerca de 150 ms para entregar cada quadro, e os quadros comprimidos dependem dos anteriores, então perder um único pacote pode impedir a exibição de um quadro e congelar a imagem por vários quadros. Há duas formas de recuperar: pedir uma retransmissão, o que só funciona se o tempo de ida e volta for curto, ou enviar redundância antecipadamente com correção de erros adiante (FEC, de forward error correction), que sempre custa banda que poderia ter carregado vídeo.

A FEC mais comum é um código de bloco, como o Reed-Solomon que o Microsoft Teams usa dentro de cada quadro. Este artigo do NSDI 2023, da Carnegie Mellon e da Microsoft, mostra com registros de chamadas reais que as perdas chegam em rajadas que muitas vezes atravessam vários quadros, um padrão para o qual os códigos de bloco desperdiçam banda. O foco são as chamadas entre duas pessoas.

## Contribuição

- **Uma análise de traços de perda de pacotes de cerca de 9.700 chamadas do Teams**, a primeira de que os autores têm notícia a verificar se os streaming codes servem às perdas reais da videoconferência. Ela mostra que as rajadas são frequentes, que muitas vezes (mas nem sempre) são seguidas de um trecho de quadros sem perda, e que o código usado em produção gasta muita banda para recuperar a tempo.
- **O Tambur, um streaming code para vídeo.** Streaming codes são uma família teórica que recupera os pacotes de uma rajada um após o outro, cada um dentro do seu prazo de exibição, e usa todo pacote de paridade que chega antes do prazo do último quadro perdido, enquanto um código de bloco recupera tudo no prazo mais cedo e desperdiça a paridade posterior. O Tambur adapta a teoria ao vídeo: define uma sobrecarga de banda por quadro, lida com quadros de tamanhos variados e com perdas de só alguns pacotes de um quadro, e tolera perdas no trecho logo depois de uma rajada. Ele também codifica os tamanhos dos quadros, de que o decodificador precisa.
- **Um preditor de sobrecarga.** Um modelo simples de aprendizado de máquina, com um bit extra de retorno do receptor, decide quanta redundância cada quadro recebe, de modo que a sobrecarga acompanhe a rede.
- **Uma plataforma de avaliação e código aberto.** Uma implementação em C++ (com as bibliotecas Jerasure 2.0 e GF-Complete) do Tambur e das referências, integrada a um emulador de videoconferência entre duas pessoas.

## Metodologia

Primeiro, uma simulação guiada por traços sobre os registros do Teams: uma amostra aleatória de chamadas ao longo de duas semanas, mantendo os cerca de 9.700 traços (16% do total) com pelo menos duas perdas, já que o Teams só liga a FEC depois da primeira perda. Uma semana foi reservada para teste. Cada traço traz o tamanho, o número de sequência e os horários de envio e recebimento de cada pacote, limitado ao último minuto da chamada.

Depois, um teste de ponta a ponta sobre uma rede emulada. O Tambur é comparado com o Block-Within (um código de bloco dentro de cada quadro, modelado no Teams) e o Block-Multi (um código de bloco entre vários quadros). Duas variantes do Tambur entram: uma que iguala a sobrecarga de banda do Block-Within e outra que troca um pouco de recuperação por menos sobrecarga.

## Resultados

Estes são os resultados relatados pelos autores.

- Nos traços, a perda média de pacotes é de 7% (1,7% em todos os traços do Teams), e 38,4% das ocorrências de perda atravessam mais de um quadro de vídeo.
- Na simulação, o Tambur recupera 26,5% mais quadros que o Block-Within usando 35,1% menos banda para redundância.
- Na rede emulada, o Tambur reduz a frequência de travamentos em 26% e sua duração acumulada em 29%, em comparação com o melhor dos dois códigos de bloco. Em relação ao Block-Within, tem 78% menos travamentos.
- Os travamentos do Tambur, quando acontecem, não são mais curtos: sua mediana dura mais que a do Block-Within, e o total menor vem de haver muito menos deles.

## Análise crítica

O estudo é feito com cuidado e seus principais limites estão declarados.

- **Só chamadas entre duas pessoas.** O projeto e a avaliação não cobrem chamadas em grupo, em que uma SFU fica no meio. Se as perdas devem ser reparadas a cada salto ou de ponta a ponta não é tratado.
- **Traços selecionados.** A análise mantém chamadas com pelo menos duas perdas e só o último minuto de cada uma. Ela mostra como os streaming codes ajudam em chamadas que já estão perdendo pacotes, não a experiência média de uma chamada.
- **Referências próprias.** O Block-Within imita o esquema do Teams, mas é implementação dos autores, e os resultados de ponta a ponta vêm de um emulador, não de uma implantação.
- **Travamentos são uma métrica.** O artigo mostra um compromisso: as variantes que economizam banda recuperam menos. Como a contagem de travamentos se traduz no que o usuário sente fica para outros estudos.
- **Custo além da banda.** O código acrescenta trabalho de codificação e decodificação e um bit de retorno. A aceleração em hardware é citada como trabalho futuro.

## Pesquisas futuras

- Chamadas em grupo, e onde, em um caminho com SFU, a redundância deve ser acrescentada ou reparada.
- Outras métricas de qualidade e um modelo aprendido melhor de quanta sobrecarga usar.
- Aceleração em hardware da codificação e da decodificação.
- Combinar FEC e retransmissões em uma chamada cujo tempo de ida e volta muda.

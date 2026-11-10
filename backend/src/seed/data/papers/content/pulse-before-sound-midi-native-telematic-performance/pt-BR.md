---
title: "Pulso antes do som: repensando presença e vivacidade na performance musical telemática com colaboração nativa em MIDI"
summary: O sistema Telemidi não transmite áudio entre os músicos remotos; ele inicia um pulso comum em cada nó e depois envia só eventos MIDI, quantizados ou em loop, para que a latência deixe de afetar o groove.
researchArea: Computação musical
keywords: performance musical telemática, midi, pulso compartilhado, soluções que aceitam a latência, performance musical em rede, pesquisa guiada pela prática
version: 1.0
updatedAt: 2026-11-10
---

## Visão geral

Performance musical em rede pela Internet costuma significar transmitir áudio, e a transmissão de áudio esbarra num limite: quando o atraso passa de uns 30 milissegundos, o artigo observa (citando Rofe e Reuben), o groove compartilhado começa a desmoronar. Cada etapa soma atraso, da transdução e conversão à compressão e ao caminho na rede, e o jitter piora tudo.

Este artigo de 2026 de Matt C. Bray (Western Australian Academy of Performing Arts, Edith Cowan University), publicado no Journal of Network Music and Arts, descreve outro desenho, chamado Telemidi. Nenhum áudio atravessa a rede. Cada músico roda uma sessão do Ableton Live quase idêntica, um pulso comum é iniciado em todos os nós no começo da performance e, a partir daí, os nós trocam apenas eventos MIDI (Note On/Off, velocity, aftertouch, Control Change, Program Change). Cada nó gera o próprio som localmente a partir desses eventos. O lema é "pulso antes do som": primeiro combinar a batida, depois enviar intenções em vez de formas de onda.

O texto é de pesquisa guiada pela prática e em grande parte conceitual. As evidências vêm da série longitudinal SHOALZ, do próprio autor (91 sessões improvisadas entre Perth e, na maioria, Londres, de 2022 a 2024), e de um único evento intercultural que ligou músicos em Muhanga, Ruanda, a órgãos de tubos em Vancouver e Calgary. Ele condensa a tese de doutorado do autor, de 2024, para a qual aponta a maior parte das notas de rodapé.

## Contribuição

- **Uma arquitetura nativa em MIDI para performance telemática.** Os nós compartilham pulso e eventos, não áudio. Cada mensagem MIDI ocupa poucos bytes, então a banda é mínima (a SHOALZ teve média de cerca de 27,78 eventos por segundo, com pico de 40,22) e não existe etapa de codificação ou decodificação de áudio.
- **Uma receita concreta de sincronização**, até onde o artigo a descreve:
  1. **Iniciar o pulso uma vez.** Um "comando de play sincronizado em UTC" (Figura 1), descrito em outro trecho como "mensagens explícitas de tempo no início da performance", dispara a reprodução da DAW em todos os nós.
  2. **Deixar cada relógio correr sozinho.** Depois do início, "o relógio da CPU de cada nó mantém esse pulso". O pulso deixa de depender da rede e, por isso, permanece "consistente de forma independente em andamento e fase, qualquer que seja a latência da rede".
  3. **Absorver a latência na grade do compasso.** O MIDI que chega é quantizado na grade comum, e o disparo de loops é quantizado para o início do próximo compasso. Um gesto feito no compasso n é ouvido em todos os lugares no início do compasso n+1, então atrasos menores que um compasso somem do ritmo.
  4. **Enviar loops inteiros.** Em vez de transmitir nota por nota, um nó pode enviar o arquivo MIDI completo de um loop gravado, com toda a sua microtemporização. A primeira passagem pode sair atrasada, mas "na terceira vez que o loop toca, ele estará idêntico em todos os nós".
  5. **Enviar antes quando for preciso.** No caso de Ruanda, a parte do teclado era enviada um tempo antes para chegar a tempo nos órgãos canadenses.
- **Uma redefinição de sincronia** como "o alinhamento processual de ações musicais intencionais dentro de uma estrutura de pulso coordenada", e não como a chegada simultânea do som a um ponto de escuta. Nessa visão, dois músicos estão sincronizados se os seus gestos caem no lugar certo da grade comum, mesmo que cada um ouça só o áudio local.
- **Um enquadramento teórico** pelo framework Latency Accepting Solutions (LAS), do autor, que trabalha com a latência em vez de tentar eliminá-la, e pelo modelo YUTPA de Caroline Nevejan (Tempo, Lugar, Ação, Relação) para a copresença.

Para um engenheiro de software que quer construir um metrônomo compartilhado entre músicos remotos, o que fica é a arquitetura: um único evento de início, relógios locais dali em diante, quantização como buffer de latência e conteúdo musical enviado como eventos pequenos com timestamp, que cada local renderiza por conta própria.

## Metodologia

Não há experimento controlado nem avaliação técnica da precisão temporal. O método é pesquisa guiada pela prática, com dois estudos de caso.

- **Série SHOALZ (2022 a 2024).** 91 sessões de improvisação documentadas, com dois músicos principais em nós distribuídos, cada um rodando uma sessão complementar do Ableton Live que envia e recebe MIDI por uma WAN. As sessões duraram de 15 a 45 minutos. Os dados vieram de logs de eventos MIDI e de gravações audiovisuais: densidade de eventos (eventos por segundo) e atraso de ida (OWD, one-way delay) entre os nós, além dos relatos dos músicos sobre alinhamento rítmico, confiança e flow.
- **Performances Ruanda-Canadá.** Um único evento com duas peças escritas (uma composição de Denis Bedárd que mistura música folclórica ruandesa e a tradição ocidental do órgão de tubos), cada uma tocada três vezes em cerca de 22 minutos. Um organista em Vancouver tocava com um metrônomo local e conduzia; o órgão de tubos de Calgary hospedava a sessão de rede e era tocado diretamente pelo fluxo MIDI que passava, vindo de Ruanda e de Vancouver; em Muhanga, um coral escolar e um tecladista tocavam junto com o MIDI que chegava, ouvido por um sampler de órgão de tubos em software. Cada nó foi documentado com logs MIDI e áudio e vídeo.

O artigo não informa o protocolo de transporte, o software que leva o MIDI pela WAN, como o OWD foi medido (além de citar a distância do traceroute) nem como o comando de início em UTC mantém os nós em fase.

## Resultados

Estes são os resultados relatados pelo autor.

- **Latência.** A SHOALZ teve OWD médio de 150,244 ms num caminho médio de traceroute de 23.963 km, sobretudo de Perth a Londres. Ao longo da série, o sistema teria suportado latências "acima de 200 milissegundos" e ainda assim produzido música estável baseada em pulso. O enlace com Ruanda passou de 330 ms de OWD porque usava a rede de dados móveis ruandesa.
- **Resultado musical.** Os músicos relataram alinhamento rítmico e coesão de conjunto consistentes, confiança crescente em se coordenar sem ouvir o nó remoto e experiências de flow, imersão e "presença distribuída". Eles desenvolveram estratégias de antecipação, disparando loops compartilhados quantizados para o próximo compasso.
- **O truque de um tempo funcionou por coincidência.** A 88 bpm, uma semínima dura 681,82 ms. Cerca de 330 ms de Vancouver a Muhanga mais cerca de 330 ms de volta ficam perto disso, então uma parte enviada um tempo antes chegava no lugar certo. O autor chama a coincidência de "feliz acaso", e antecipar acordes às vezes produzia dissonâncias não intencionais.
- **As transmissões para o público não eram sincronizadas.** O público online podia assistir a Vancouver, Calgary ou Muhanga, mas os três fluxos não estavam alinhados, o que o autor lê como sinal de que a saída para o público precisa de coordenação própria.
- **Limites declarados.** A resolução de 7 bits do MIDI para velocity e controladores, notas presas quando há perda de pacotes e o encaixe ruim com improvisação livre, ambient e outras músicas sem pulso regular.

## Análise crítica

O desenho central é bom e familiar para quem já construiu um sistema distribuído: não enviar estado continuamente quando dá para enviar um sinal de início mais eventos pequenos e determinísticos, e esconder a latência atrás de uma fronteira de agendamento (aqui, o próximo compasso). Para música eletrônica baseada em loops é uma resposta prática, e um OWD de 150 a 330 ms está muito além do que a transmissão de áudio tolera. As evidências, porém, são fracas para o tamanho das afirmações.

- **Não se mede o que importa.** O artigo nunca informa o quanto os pulsos dos nós concordam em fase, quanto derivam ao longo de uma sessão de 45 minutos nem com que frequência eventos caíram no compasso errado. "Robusto" e "estável" se apoiam nos autorrelatos dos músicos e em números de densidade de eventos e de OWD que nada dizem sobre sincronia. O artigo não identifica os dois músicos da SHOALZ nem diz se o autor é um deles.
- **A questão do relógio é pulada.** Depois do comando de início, "o relógio da CPU de cada nó" mantém o pulso. Relógios de computador soltos derivam (outros trabalhos da área medem deriva da ordem de um milissegundo por segundo), então ao longo de uma sessão longa duas DAWs podem se afastar, a menos que algo as ressincronize. O artigo não diz se usa Ableton Link, NTP ou qualquer outra coisa, nem como um "comando de play em UTC" enviado por um caminho de 150 ms evita que os nós comecem com 150 ms de diferença. Um início em UTC só funciona se as duas máquinas já concordarem sobre o UTC, o que exige sincronização de relógios própria.
- **Os números das sessões não fecham.** O texto fala em 91 sessões com média de "aproximadamente 19 minutos e 45 segundos" e total de 34 horas e 54 minutos. Mas 91 vezes 19:45 dá cerca de 29 horas e 57 minutos; 34:54 divididos por 91 sessões dariam média de cerca de 23 minutos. Um dos números está errado.
- **"Apesar dessa variabilidade" se refere a uma variabilidade que nunca aparece.** Só é dado o OWD médio, sem dispersão nem jitter, embora o jitter seja justamente o problema declarado.
- **O mecanismo dos loops é pouco explicado.** Por que um loop fica idêntico em todos os nós "na terceira vez" em que toca não é explicado (provavelmente uma passagem de gravação, uma transferência e depois a reprodução), e o orçamento de latência para enviar um arquivo MIDI inteiro não é discutido.
- **O caso de Ruanda é outro modelo.** Ali os músicos ruandeses seguiam o MIDI que chegava, e não uma cópia local de um pulso comum, e a solução dependia de uma ida e volta que por acaso equivalia a um tempo a 88 bpm. O artigo o apresenta como compartilhamento de pulso "ainda que bem menos organizado", mas na prática é compensação manual de latência, que quebraria em outro andamento ou em outra rede.
- **A sincronia é redefinida, não alcançada.** Chamar de sincronia o fato de os gestos caírem na mesma grade enquanto cada músico ouve só o áudio local é uma escolha de projeto legítima, mas também significa que ninguém ouve o conjunto real em tempo real. Os músicos reagem aos gestos remotos com pelo menos um compasso de atraso, o que serve para música de loops e exclui pergunta e resposta apertadas.

Para quem vai construir um metrônomo compartilhado, o artigo vale como padrão de arquitetura, não como especificação. As peças que faltam (base de tempo comum, agendamento do início, correção de deriva, tratamento de perda de pacotes) precisam vir de outro lugar, por exemplo relógios disciplinados por GPS ou NTP, a abordagem do Metrônomo Global ou o Ableton Link em cada LAN.

## Pesquisas futuras

- Testar a coordenação nativa em MIDI em mais gêneros, formações e condições de rede, como o autor propõe, sobretudo além de um duo.
- Desenhos híbridos que combinem a coordenação por MIDI com transmissão seletiva de áudio.
- Protocolos de controle de maior resolução, como o Open Sound Control (OSC), no lugar do MIDI de 7 bits, além de mecanismos contra notas presas na perda de pacotes.
- Estratégias de coordenação para linguagens sem pulso regular, como improvisação livre e ambient, que o autor deixa como questão em aberto.
- Sincronizar as saídas enviadas ao público remoto, que ficaram desalinhadas no evento Ruanda-Canadá.
- Medição objetiva da concordância de pulso e da deriva entre os nós, que o artigo não traz e que seria necessária para sustentar as afirmações de robustez.

---
title: "Uma visão geral das tecnologias de performance musical em rede"
summary: Um levantamento de 2016 que reúne o que os estudos perceptivos dizem sobre quanto atraso músicos remotos toleram, decompõe o atraso em um sentido em suas parcelas e compara os sistemas criados para transmitir música ao vivo entre músicos distantes.
researchArea: Computação musical
keywords: performance musical em rede, orçamento de latência, tolerância à latência, sincronização de relógios, streaming de áudio, levantamento
version: 1.0
updatedAt: 2026-11-10
---

## Visão geral

Performance musical em rede (NMP, na sigla em inglês) é quando músicos em lugares diferentes tocam juntos em tempo real, cada um ouvindo os outros por meio de uma rede. Numa videochamada, algumas centenas de milissegundos de atraso incomodam, mas dá para conversar. Tocar em conjunto depende de uma precisão de dezenas de milissegundos, e o atraso da rede nunca fica abaixo do tempo que a luz leva para percorrer a distância.

Cristina Rottondi (IDSIA, Lugano), Chris Chafe (CCRMA, Stanford), Claudio Allocchio (GARR, a rede acadêmica italiana) e Augusto Sarti (Politecnico di Milano) escreveram este levantamento para a IEEE Access, publicado em dezembro de 2016. Ele junta três linhas de trabalho que costumam ser lidas em separado: os experimentos psicoacústicos que medem como a latência afeta andamento e sincronia, a engenharia da cadeia de áudio do microfone ao fone, e os frameworks de software criados para ensaios, aulas e concertos remotos.

Para um engenheiro de software que quer manter um metrônomo compartilhado em sincronia entre vários músicos remotos, o artigo funciona como um mapa. Ele mostra quantos milissegundos existem para gastar, para onde vai cada um (blocos da placa de som, buffer de jitter, codec, fibra), quais limites de tolerância a literatura sustenta e quais técnicas de sincronização (NTP, GPS, recuperação de relógio por PLL, reamostragem, um fluxo dedicado de metrônomo) os sistemas anteriores usaram.

## Contribuição

Os autores descrevem a contribuição como tripla, e o artigo segue essa divisão:

- **Uma revisão dos estudos de tolerância à latência.** A Seção III reúne os experimentos perceptivos da década anterior, aproximadamente (duplas batendo palmas, duos de instrumentos, uma ópera distribuída), e organiza os resultados pelo fator testado: andamento, timbre e tempo de ataque, reverberação, complexidade rítmica, formação musical, estratégias de compensação, presença de regente e áudio com vídeo.
- **Uma decomposição do atraso fim a fim.** A Seção IV define o atraso total em um sentido da fonte ao ouvido (OOSE, Overall One-way Source-to-Ear) como uma cadeia de doze etapas, escreve esse atraso como uma soma de termos e deriva um limite inferior que depende só de taxa de amostragem, tamanho de bloco, comprimento do filtro, tamanho do buffer de jitter, atraso do codec e distância. É a parte que um desenvolvedor consegue transformar diretamente num orçamento.
- **Uma comparação de frameworks de NMP.** A Seção V compara sistemas existentes por finalidade, arquitetura (ponto a ponto, cliente e servidor, multicast), alcance de rede, pilha de protocolos, tipos de dados suportados e método de sincronização de fluxos.
- **Uma taxonomia de estratégias para tocar com atraso**, tirada de Carôt e Werner: interação realista, mestre e escravo, e retorno atrasado (acrescentar um autoatraso artificial), incluindo a variante que depende de um metrônomo soando em sincronia nas duas pontas.
- **Um resumo do tratamento de perda de pacotes**, da duplicação, intercalação e correção antecipada de erros no transmissor até a ocultação no receptor por inserção, interpolação e regeneração.
- **Uma agenda de pesquisa** na Seção VI, que defende tratar NMP como um problema perceptivo, e não só de rede.

## Metodologia

É um levantamento narrativo, não uma revisão sistemática. Não há protocolo de busca, critério de inclusão nem contagem de artigos triados. Os autores escolhem trabalhos que consideram representativos, e boa parte vem dos próprios grupos: os estudos de palmas do CCRMA (Chafe e colegas), a análise de atraso de pacotes baseada em características do áudio (Rottondi, Sarti e colegas) e o sistema LOLA (Allocchio e colegas).

A parte perceptiva se apoia num modelo experimental comum, que o levantamento descreve explicitamente. Em todos os estudos, exceto o da ópera distribuída, dois músicos ficam em salas isoladas acusticamente, em geral anecoicas, ouvem um ao outro por fones, não se veem e escutam o próprio instrumento sem atraso adicional. O atraso é inserido por um computador central ou por um emulador de rede como o Netem numa LAN cabeada. Os atrasos são constantes em todos os estudos menos um ([39], Rottondi e colegas, 2015), que sorteia o atraso de cada pacote de uma distribuição normal para emular jitter. As condições de atraso são sorteadas e escondidas dos participantes, e a maioria dos estudos dá alguns compassos do andamento de referência, por um instrutor ou um metrônomo, antes de cada tentativa.

O levantamento também explica como esses estudos medem os resultados, o que serve para quem quer avaliar o próprio sistema. Os ataques t(n) são encontrados à mão ou por busca de picos, os intervalos entre ataques são `IOI(n) = t(n+1) - t(n)` e o andamento em BPM é `60 / IOI(n)`. A partir disso aparecem o ritmo médio (IOI médio), a regularidade (coeficiente de variação dos IOIs), a assimetria (atraso médio de um músico em relação ao outro), a imprecisão (desvio padrão desse atraso) e a inclinação do andamento (um ajuste linear da série de andamento, positivo quando acelera e negativo quando desacelera). Notas subjetivas e questionários completam o quadro.

Dois modelos analíticos são resumidos. Um trata os músicos como osciladores acoplados que corrigem a frequência a partir de uma comparação de fase atrasada, o que dá um andamento estável `Ω = ω / (1 + Kτ)`, em que ω é a média das duas frequências naturais, τ o atraso e K uma constante de acoplamento. O outro, de Gurevich e colegas, supõe músicos sem memória que reagem só à última batida ouvida, de modo que o intervalo cresce τ a cada batida: `δ(n) = 60 / (60/δ + nτ)`. O levantamento o apresenta como um limite inferior do andamento real, já que músicos integram mais de uma batida.

A parte de engenharia parte de princípios básicos (amostragem, processamento em blocos, buffers, empacotamento, propagação, roteamento) e depois é confrontada com as escolhas de projeto dos frameworks existentes, que o levantamento resume numa tabela (Tabela 3). As Tabelas 1 e 3 são imagens no PDF publicado, então esta análise usa só o que o texto corrido afirma sobre elas.

## Resultados

**Faixas de tolerância relatadas pelos estudos perceptivos.** A introdução cita um limite muito repetido de 20 a 30 ms em um sentido, equiparado a 8 a 9 m de distância acústica, o limite tradicional para manter um andamento comum sem regente. A revisão detalhada depois refina esse número:

- Abaixo de 10 a 15 ms, todos os estudos relatam inclinação positiva: as duplas aceleram, o que se atribui à tendência natural de antecipar a batida.
- De 10 a 15 ms até 20 a 25 ms, o andamento fica estável e perto da referência, as notas são positivas e a latência mal é percebida.
- De 20 a 25 ms até 50 a 60 ms, o atraso passa a ser claramente perceptível, os músicos desaceleram, as notas caem, e a imprecisão e a assimetria (estáveis abaixo de 25 a 30 ms) começam a subir.
- Acima de 60 ms a performance fica muito prejudicada e é julgada pouco tolerável; a regularidade dentro de uma mesma parte piora bastante acima de 60 a 80 ms.
- Com atrasos muito altos, alguns músicos passam ao "piloto automático" e ignoram o parceiro: um estudo encontra a maior variação de andamento entre 50 e 100 ms e menos variação, mas andamento mais baixo, acima de 100 ms.

**O que desloca essas faixas.** Andamentos mais rápidos reduzem a tolerância: em [39], bateristas e baixistas tocando semínimas toleraram em média cerca de 40 ms a 60 BPM, mas só cerca de 15 ms a 120 BPM. Timbres ruidosos ou brilhantes (alta entropia espectral, planicidade ou centroide) tenderam mais a desacelerar acima de 35 ms. Ataques lentos desaceleraram mais que ataques secos, mas deram melhor sincronia. Músicos treinados desaceleraram mais que leigos, enquanto os leigos ficaram menos sincronizados. Com atrasos assimétricos, o levantamento afirma que o efeito é dominado pelo maior dos dois sentidos. Acrescentar autoatraso de um lado elevou a aceitação para 65 ms num estudo e 190 ms em outro (embora autoatraso acima de 30 ms parecesse "artificial"); autoatraso dos dois lados chegou no máximo a 80 ms e foi rejeitado por muitos participantes. No modo mestre e escravo, em que quem lidera ignora quem segue, dá para tolerar atrasos de cerca de 100 a 200 ms. Um regente deu uma referência comum e, contra a intuição, o andamento subiu com atrasos altos.

**O orçamento do atraso em um sentido.** O levantamento escreve o atraso OOSE como

`Dtot = 2(Da + Dc + Ds) + Db + Dp + Dt + Dq`

em que o fator 2 conta placa de som e codec no transmissor e no receptor, e os termos são:

- **Da, conversão:** um período de amostra, 20,83 µs a 48 kHz, mais algum filtro.
- **Dc, codec:** no mínimo 20 ms para codecs no estilo MP3, por isso considerados inviáveis; 4 a 8 ms para codecs de baixo atraso (Opus, ULD, Wavpack). Vários frameworks mandam áudio sem compressão para zerar Dc.
- **Ds, bloco da placa de som:** `P / R` para um bloco de P amostras (normalmente múltiplo de 64). Blocos pequenos reduzem o atraso, mas aumentam a taxa de interrupções e o custo do sistema operacional; um SO de uso geral acrescenta até alguns ms de ruído de escalonamento.
- **Db, buffer de jitter:** com B blocos e reprodução começando com metade do buffer cheio, `B·P / (2R)`. É aqui que jitter de rede e deriva de relógio são absorvidos; pequeno demais gera esvaziamento (buracos no som), grande demais acrescenta atraso.
- **Dp, propagação:** `L / cm`, com velocidade do sinal de cerca de 0,8c no cobre e 0,7c na fibra, perto de 5 µs por km.
- **Dt, transmissão, e Dq, processamento e filas nos roteadores:** Dq depende de topologia, congestionamento e política da operadora e costuma ser modelado como variável aleatória.

Desprezando Dq e Dt, o levantamento dá o limite inferior `Dtot >= 2((1 + F + P)/R + Dc) + B·P/(2R) + L/cm`, com F o comprimento do filtro em amostras, e o plota para F = 100, B = 8 e L = 1000 km. Fazendo a conta à mão com R = 48 kHz e sem codec (essa aritmética é nossa, não do artigo): P = 64 dá cerca de 6,9 + 5,3 + 4,8 = 17 ms, P = 128 dá cerca de 25 ms e P = 256 dá cerca de 41 ms. Tamanho de bloco e profundidade do buffer pesam mais que a distância a 1000 km, e as filas dos roteadores ainda vêm por cima. O modelo sem memória dá uma ideia do que acontece quando o orçamento estoura: a 90 BPM com τ = 20 ms, depois de dez batidas o limite inferior cai para cerca de 69 BPM (de novo, conta nossa).

**Perda de pacotes.** Em redes acadêmicas muito limpas, com perdas de 10^-6 a 10^-8 e jitter abaixo de 1 ms, o LOLA não aplica correção nenhuma. Fora isso, a ocultação no receptor funciona melhor abaixo de 15% de perda e com pacotes de 4 a 40 ms; inserir silêncio só é aceitável com pacotes de 4 a 16 ms e piora acima de 2% de perda; remendos por sobreposição e soma pioram com lacunas acima de 20 ms ou perda acima de 3%.

**Arquiteturas e protocolos.** Malhas ponto a ponto enviam e recebem N - 1 fluxos por participante, o que esbarra em uplinks domésticos de poucos Mb/s quando cada fluxo tem centenas de kb/s. Projetos cliente e servidor mixam num nó central, então cada cliente lida com um fluxo em cada sentido, ao custo de um salto extra e de carga no servidor; NetFPGA, o roteador Click e o Netmap são comparados como formas de evitar cópias entre kernel e espaço de usuário no servidor. Multicast, por exemplo sobre redes centradas em informação, limita o uplink a um fluxo, mas manda a mesma mixagem para todos. Todos os frameworks comparados usam UDP para mídia, alguns acrescentam RTP/RTCP para carimbos de tempo e números de sequência, e SIP e HTTP sobre TCP cuidam de sessão e controle. O alcance de rede fica limitado a alguns milhares de km. Codecs de vídeo vindos da telemedicina e do cinema costumam passar de 60 ms.

**Sincronizando relógios e a batida.** Placas de som com taxas nominalmente iguais derivam, o que causa esvaziamento e transbordamento de buffer ao longo de minutos. O levantamento lista as técnicas usadas: carimbos de tempo mais um relógio mestre recuperado por PLL (via RTP/RTCP ou NTP); NTP com precisão de cerca de 0,2 ms numa LAN, mas até alguns ms numa WAN; sinais de tempo de GPS ou CDMA com precisão de dezenas de microssegundos; servidores de tempo GPS baratos (o "metrônomo global" de Oda e Fiebrink); ajuste do relógio de referência a partir da defasagem entre os callbacks de áudio remoto e local (usado no Soundjack e no JamBerry); MIDI Clock a 24 pulsos por semínima vindo de um servidor; reamostragem a `Rr = (R̂M·PS) / (R̂S·PM)` a partir das taxas estimadas de mestre e escravo; e um metrônomo enviado como fluxo de dados próprio pelo servidor ou por um dos pares (DIAMOUSES). Para um clique compartilhado, a receita mais próxima no artigo é a variante de retorno atrasado: cada músico acrescenta um autoatraso igual ao atraso de rede em um sentido e segue um metrônomo que soa em sincronia perfeita nas duas pontas, o que os autores avisam ser difícil por causa da deriva dos relógios locais.

**Sistemas citados no texto** incluem LOLA (áudio e vídeo de baixa latência, sem compressão, feito para redes acadêmicas), JackTrip (CCRMA, UDP com redundância), Soundjack, JamBerry (um dispositivo com Raspberry Pi), DIAMOUSES, MusiNet e o projeto llcon. A tabela de comparação em si é imagem no PDF, então esta lista cobre só os sistemas mencionados no texto.

## Análise crítica

- **Escrito antes de a área mudar.** O artigo é de 2016. É anterior ao 5G, à fibra doméstica de baixo atraso em larga escala e à pandemia de 2020, quando ferramentas como Jamulus (cujo antecessor llcon aparece só como URL), as versões novas do JackTrip, o SonoBus e sistemas no navegador saíram do nicho de pesquisa para o uso diário de corais e bandas. Resultados desse uso real em massa, com muito mais que dois músicos, naturalmente não estão aqui.
- **A evidência perceptiva é estreita.** Quase todo experimento põe duas pessoas em salas anecoicas, com fones, sem contato visual e com um atraso constante inserido. Só um estudo modela jitter, só um envolve mais de dois músicos (a ópera), e o próprio levantamento reconhece que uma avaliação completa do vídeo e do desalinhamento entre áudio e vídeo ainda está por fazer. As faixas são sólidas para duos correndo atrás das palmas um do outro e bem menos para grupos maiores ou salas reais.
- **Inconsistências no texto.** O limite de 20 a 30 ms é equiparado a 8 a 9 m de ar, mas a cerca de 343 m/s esses tempos correspondem a algo entre 7 e 10 m, então 8 a 9 m só bate com o meio da faixa. A letra B é usada para o tamanho do buffer em blocos e, poucas linhas depois, para a banda da rede (que logo antes se chamava C). As três estratégias de compensação são dadas como "enumeradas na Seção I", quando aparecem na Seção II-B, e a mesma frase diz que todos os trabalhos tratam das três estratégias, embora só dois estudos testem autoatraso. A fórmula do atraso de transmissão sai truncada no texto publicado.
- **A assimetria aparece simplificada.** O levantamento diz que atrasos assimétricos são dominados pelo sentido maior, citando Chafe e Gurevich 2004. Aquele artigo apresenta isso só como hipótese a partir de poucos dados, válida até cerca de 25 ms, e sugere algo mais perto da mediana dali em diante. O levantamento deixa de fora a ressalva e a segunda metade.
- **O orçamento é um limite inferior.** A equação 4 descarta filas nos roteadores e tempo de transmissão, que na Internet pública são justamente os termos variáveis que obrigam a usar buffers de jitter maiores. O exemplo plotado também supõe 1000 km de fibra em linha reta, enquanto rotas reais são mais longas que a distância geográfica. O leitor deve tratar a curva como o melhor caso.
- **Autocitação e ponto de vista.** Vários resultados e sistemas centrais vêm dos grupos dos próprios autores (estudos de palmas do CCRMA, a análise de 2015, o LOLA sobre a GARR). É natural num levantamento escrito por quem construiu a área, mas a seleção não é sistemática e a comparação de frameworks é descritiva, sem números de latência medidos em condições comuns.
- **Lacunas para quem quer um metrônomo compartilhado.** A seção de sincronização lista mecanismos, mas quase não traz números sobre quão bem eles mantêm uma batida alinhada ao longo do tempo, e não discute o PTP (IEEE 1588), a abordagem de compartilhar andamento e fase depois popularizada por ferramentas como o Ableton Link, nem sistemas por intervalo como o NINJAM, que atrasam tudo de propósito em um compasso inteiro. A própria revisão perceptiva mostra que um clique local alinhado a um relógio comum evita a espera mútua, mas os músicos continuam se ouvindo atrasados; o artigo não estuda essa combinação diretamente.

## Pesquisas futuras

- Fazer estudos perceptivos com grupos maiores, salas realistas, jitter e perda de pacotes, em vez de atraso constante entre dois músicos isolados, como os próprios autores pedem.
- Medir como um metrônomo compartilhado alinhado a um relógio comum (NTP, GPS ou PTP) interage com o áudio atrasado dos outros músicos, incluindo quanta defasagem de relógio entre os locais é audível.
- Comparar frameworks sob condições de rede idênticas e publicar o atraso OOSE medido por etapa, para conferir o limite inferior da equação 4 na prática.
- Testar buffers de jitter adaptativos e compensação de deriva por reamostragem contra os artefatos de esvaziamento e transbordamento descritos no levantamento.
- Estudar como os músicos se adaptam com o tempo, incluindo os efeitos de idade e familiaridade que os autores citam de forma anedótica, e se treino aumenta a tolerância.
- Seguir a agenda proposta pelos autores: métricas sensíveis ao conteúdo além da inclinação do andamento, o papel da taxa de quadros e da resolução do vídeo, previsão do que o parceiro vai tocar ("robotic musicianship") e uma ontologia para organizar o conhecimento sobre NMP.
- Revisitar os números com dados pós-2020 do uso em massa de ferramentas de NMP sobre banda larga doméstica e 5G.

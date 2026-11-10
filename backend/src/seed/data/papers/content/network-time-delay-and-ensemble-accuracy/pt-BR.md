---
title: "Atraso de rede e precisão de conjunto: efeitos da latência e da assimetria"
summary: Um experimento controlado de palmas feito em Stanford que mede como o atraso de áudio em um sentido entre dois participantes isolados faz o andamento compartilhado acelerar, se manter ou se arrastar.
researchArea: Computação musical
keywords: performance musical em rede, latência, sincronia de conjunto, deriva de andamento, assimetria de atraso, ritmo
version: 1.0
updatedAt: 2026-11-10
---

## Visão geral

Tocar música em grupo depende de uma precisão de tempo de poucos milissegundos, e quando os músicos estão ligados por uma rede, todo caminho acrescenta atraso. A pergunta deste artigo é simples: quanto atraso em um sentido duas pessoas toleram antes que manter um pulso estável juntas deixe de funcionar, e atraso zero é mesmo o ideal?

Chris Chafe e Michael Gurevich, do Center for Computer Research in Music and Acoustics (CCRMA) de Stanford, respondem com um experimento propositalmente enxuto. Duplas de pessoas em duas salas isoladas batem palmas em um ritmo intercalado ouvindo uma à outra só por fones de ouvido, e um computador insere um atraso conhecido entre elas. O artigo foi apresentado na 117ª Convenção da AES, em São Francisco, em outubro de 2004. Ele repete um estudo piloto de 2001 do mesmo grupo, com controles mais rígidos e mais tentativas perto do atraso zero, e é o experimento normalmente citado quando se diz que um conjunto deixa de funcionar além de algumas dezenas de milissegundos.

Para um engenheiro de software que está construindo um metrônomo compartilhado ou uma jam para músicos remotos, ele oferece um retrato inicial e medido do que a latência faz com pessoas que se escutam para ficar no tempo.

## Contribuição

- **O atraso como variável controlada.** Em vez de observar sessões reais pela Internet, em que atraso, jitter e perda variam juntos, os autores fixam o atraso em um sentido de cada tentativa entre 0 e 77 ms e mantêm todo o resto constante. O maior atraso equivale a cerca de 20 m de som viajando pelo ar.
- **Uma medida automática da precisão do conjunto.** Os ataques das palmas são detectados por participante e transformados em uma série temporal de andamento. Dois números resumem cada tentativa: a inclinação do andamento (se a dupla acelerou ou desacelerou) e o jitter do andamento (o quanto o pulso oscilou em torno dessa tendência).
- **Um modelo linear da deriva do andamento em função do atraso**, com um ponto de cruzamento em que a dupla nem acelera nem desacelera. Os autores o chamam de "ponto ideal" da precisão do conjunto e o situam em 11,5 ms.
- **A observação de que um pouco de atraso ajuda.** Atrasos muito curtos, inclusive zero, fizeram as duplas acelerar. Esse atraso "benéfico" foi o resultado surpreendente do estudo piloto e é confirmado aqui.
- **Primeiras observações de atrasos assimétricos e de uma faixa maior de andamentos**, apresentadas como dados exploratórios que geram hipóteses, não conclusões.
- **Uma tradução para termos de rede.** O ponto ideal é convertido em uma distância física para redes reais, e os autores listam o que as redes IP acrescentam (assimetria, jitter e perda de pacotes) e o experimento não cobre.

## Metodologia

**Participantes e tarefa.** Foram gravadas 17 duplas de estudantes e funcionários de Stanford, parte paga com vales-presente e parte participando como atividade de um curso de computação musical. Nenhuma habilidade musical foi exigida. As pessoas foram pareadas ao acaso, praticaram o ritmo frente a frente e receberam apenas a instrução de mantê-lo regular depois de começar, sem estratégia nem dicas. Duas sessões foram descartadas porque a dupla não conseguia executar o ritmo, o que foi julgado subjetivamente e confirmado por um jitter de andamento muito alto (uma ANOVA as separou das demais com p = 1,0 × 10^-8). Restaram 15 sessões válidas e 173 tentativas, depois de descartadas também 7 tentativas incompletas.

**Montagem.** Os dois participantes ficavam nas salas de gravação e de controle do CCRMA, isoladas acusticamente e apelidadas de "San Francisco" e "New York", cercados de painéis absorventes. Cada um tinha um microfone a 0,3 m à frente da cadeira, que alimentava os fones fechados do parceiro, de modo que ninguém ouvia o próprio som voltar atrasado. Um único PC com Linux e interface de áudio de 96 kHz rodava um software próprio em C++ construído sobre as classes de áudio do STK, aplicava os atrasos, gravava as duas salas em sincronia como estéreo de 16 bits e 96 kHz e conduzia o protocolo. Os atrasos foram conferidos com um osciloscópio analógico, e o 0 ms verdadeiro foi obtido com um desvio analógico em volta da interface.

**Tentativas.** Cada dupla fez 18 tentativas em cerca de 25 minutos. A primeira e a última eram de calibração: os dois batiam palmas junto com uma gravação, e não um com o outro. Em todas as outras, um participante escolhido ao acaso ouvia por 5 segundos um metrônomo de palmas gravadas no novo andamento e começava o ritmo; o parceiro não ouvia nada até ali e entrava quando quisesse. O retorno entre as salas era desligado após 36 segundos. Três experimentos foram misturados em ordem aleatória:

- **Experimento 1**, atraso simétrico: 12 atrasos seguindo a recorrência d(n) = n + 1 + d(n-1), que dá 0, 2, 5, 9, 14, 20, 27, 35, 44, 54, 65 e 77 ms. Cada dupla tocou cada atraso uma vez, começando em 86, 90 ou 94 bpm, escolhidos ao acaso.
- **Experimento 2**, atraso assimétrico: duas tentativas por sessão com um atraso diferente em cada sentido.
- **Experimento 3**, andamento inicial: duas tentativas por sessão a 60, 80, 100 ou 120 bpm, com um conjunto mais esparso de atrasos simétricos (2, 9, 20, 35, 54 e 77 ms).

**Medição.** Um detector de ataques (a técnica "amplitude surfboard") marcou cada palma com precisão de ±0,25 ms, e um único limiar de amplitude eliminou ruídos espúrios em todas as sessões. Os intervalos entre ataques viraram uma série de andamento instantâneo por participante, depois unidas para a dupla. Converter intervalos em batidas por minuto exigiu um rastreamento adaptativo, porque sob forte desaceleração uma colcheia lenta pode parecer uma semínima. A inclinação do andamento é a inclinação de uma regressão linear sobre a série unida; o jitter do andamento é a variância dos resíduos dessa regressão.

## Resultados

- **Atraso e deriva seguem uma reta.** A inclinação média do andamento em função do atraso se ajusta ao modelo linear ŷ = 0,58 - 0,05x com r² = 0,98. Quanto maior o atraso, mais forte a desaceleração, e o intercepto positivo confirma que as duplas aceleram com atraso zero, como no estudo piloto.
- **Um ponto ideal em 11,5 ms de atraso em um sentido.** É onde o modelo prevê aceleração líquida nula. Abaixo dele, 74% das execuções aceleraram; a partir de 14 ms, 85% desaceleraram.
- **O andamento inicial não fez diferença na faixa estreita.** Uma ANOVA da inclinação do andamento entre 86, 90 e 94 bpm não encontrou diferença significativa (p = 0,25), e uma ANOVA de dois fatores sobre as 36 combinações de 12 atrasos e 3 andamentos não encontrou interação entre andamento e atraso.
- **Atrasos longos produzem um arrasto recursivo.** Os autores o descrevem como "o músico A esperando o músico B, que espera o músico A". Um modelo de pura espera prevê um andamento de 60/(T0 + n(d - dbest)) batidas por minuto, que desacelera mais rápido do que até as piores tentativas reais. As gravações mostram participantes antecipando, resistindo ao arrasto ou ignorando um ao outro por instantes. Os atrasos mais longos em geral também tiveram variância alta.
- **Nenhuma tendência embutida à estabilidade.** Mesmo com a instrução de manter o andamento regular, os dados não se concentram em torno da deriva zero. Os autores leem o cruzamento brusco em 11,5 ms como sinal de alguma constante de tempo humana ainda não identificada, e não de um sistema que se autocorrige.
- **A assimetria pareceu tolerável, mas os dados são escassos.** Vinte e nove gravações assimétricas válidas, com razões entre os dois sentidos de 1,2 a 4,5 (lado curto de 2 a 54 ms, lado longo de 9 a 77 ms), deram uma ou duas tentativas por condição. Os autores sugerem que as duplas se mantiveram travadas apesar da assimetria, que o maior dos dois atrasos domina até cerca de 25 ms e que, além disso, o atraso efetivo fica mais próximo da mediana dos dois. Eles afirmam que as duas hipóteses ainda precisam ser testadas.
- **Faixa maior de andamentos.** Vinte e duas gravações válidas entre 60 e 120 bpm mostraram que os andamentos mais lentos aceleraram em relação aos demais e os mais rápidos desaceleraram, mas a relação geral entre deriva e atraso seguiu a mesma tendência inversa.
- **Em termos de rede**, 11,5 ms em um sentido correspondem a um raio de cerca de 2.400 km, supondo sinais a aproximadamente 70% da velocidade da luz e nenhum atraso de roteamento. Os autores também observam que um trabalho de conjunto sensível parece possível em caminhos bem longos, e dão como exemplo São Francisco a Denver, com cerca de 20 ms em um sentido.

## Análise crítica

- **Palmas não são música.** A tarefa era um único ritmo intercalado simples, com sons secos e de ataque brusco, em salas tratadas para minimizar os efeitos do ambiente. Os próprios autores dizem que a reverberação quase certamente mascara o efeito em situações mais naturais, porque espalha a chegada de cada som. Instrumentos de ataque lento, melodia, harmonia ou um regente mudam o que os músicos escutam, então os 11,5 ms não devem ser lidos como uma constante universal.
- **Fones sem retorno próprio.** Os participantes nunca ouviam o próprio som voltar, então não tinham noção do tamanho do atraso, e alguns culpavam o parceiro pela deriva. Os testes reais do CCRMA usaram alto-falantes e deixaram os músicos "ouvirem o atraso", o que, segundo o artigo, pode até ser aproveitado. Os resultados nos dois tipos de monitoração podem ser diferentes.
- **A amostra.** Quinze duplas aproveitáveis de estudantes e funcionários de Stanford, sem exigência de habilidade musical, com duas duplas excluídas por mau desempenho. É uma amostra razoável de laboratório, mas diz pouco sobre conjuntos profissionais, que podem tolerar ou compensar o atraso de outro jeito.
- **Na prática, um só andamento.** O resultado principal vem de 86 a 94 bpm. O Experimento 3 sugere que andamentos mais lentos se comportam de outra forma, e os dados de assimetria são declaradamente esparsos demais para previsão, então os dois são pontos de partida, não resultados para guiar um projeto.
- **Só atraso fixo e limpo.** Cada tentativa tinha um atraso constante com áudio perfeito. Caminhos IP reais acrescentam jitter, perda de pacotes e rotas que mudam, o que os autores listam como trabalho em aberto. Um sistema que esconde o jitter atrás de um buffer o transforma em mais atraso fixo, e é esse orçamento que o artigo ajuda a fazer.
- **Status da publicação.** É um artigo de convenção da AES. A primeira página diz que ele foi reproduzido a partir do manuscrito dos autores, sem edição nem avaliação pelo Review Board da AES, então não passou por revisão por pares no sentido de um periódico. Também é de 2004, e o PDF ainda tem marcadores de citação não resolvidos.
- **O "limiar de 25 ms".** O número atribuído popularmente a este trabalho não aparece no texto como um limiar único. O artigo relata um ponto ideal em 11,5 ms, desaceleração na maioria das tentativas a partir de 14 ms, cerca de 25 ms só como fronteira de uma hipótese sobre atrasos assimétricos e 20 ms como exemplo de caminho longo utilizável. Estudos posteriores do mesmo grupo e de outros, com mais músicos, instrumentos reais e outros andamentos, em geral refinaram e matizaram esses números em vez de fixar um corte único.
- **Para um metrônomo compartilhado.** O experimento não testou um clique sincronizado: o metrônomo só tocava para quem iniciava, antes da tentativa. O que ele mostra é que, quando duas pessoas perseguem o som uma da outra, um atraso acima de cerca de 11,5 ms puxa o andamento para baixo de forma constante. Um projeto que dá a cada local um clique próprio alinhado a um relógio comum evita a espera mútua pelo pulso em si, mas os músicos ainda se ouviriam com atraso, e o artigo não traz dados sobre como essa combinação se comporta.

## Pesquisas futuras

- Repetir o protocolo com músicos treinados, instrumentos reais e peças mais longas, e com salas reverberantes em vez de secas, como os autores pretendem fazer em relação à reverberação.
- Testar a monitoração por alto-falantes e o próprio eco, em que os participantes conseguem ouvir o atraso, contra os fones isolados.
- Reunir tentativas assimétricas suficientes para testar as duas hipóteses de assimetria, e acrescentar jitter e perda de pacotes para ver como eles se combinam com o atraso fixo.
- Estudar uma faixa de andamentos maior e mais densa, já que a inclinação da deriva pode depender do período do pulso.
- Medir o que acontece quando um metrônomo compartilhado, alinhado por relógio, é somado à escuta mútua, que é o caso que uma ferramenta de jam ou de ensaio em rede realmente enfrenta.
- Explicar o ponto ideal de 11,5 ms por meio de modelos de rastreamento humano de andamento e de como os ouvintes decidem quem tocou primeiro.

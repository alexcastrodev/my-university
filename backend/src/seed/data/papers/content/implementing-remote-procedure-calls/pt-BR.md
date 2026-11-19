---
title: "Implementando chamadas de procedimento remoto"
summary: Birrell e Nelson descrevem o mecanismo de RPC construído para o Cedar no Xerox PARC, em que uma chamada remota se parece com uma chamada local por meio de stubs gerados, faz o binding pelo banco Grapevine e roda sobre um protocolo de pacotes feito sob medida, com confirmações implícitas e quase nenhum estado de conexão.
researchArea: Sistemas distribuídos
keywords: chamada de procedimento remoto, stubs, binding, protocolo de transporte, semântica de chamada, desempenho
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Chamadas de procedimento remoto (RPC) parecem ser um paradigma útil para a comunicação pela rede entre programas escritos em linguagem de alto nível. Este artigo descreve um pacote que oferece RPC, as opções que o projetista de um pacote desse tipo enfrenta e as decisões que tomamos. Descrevemos a estrutura geral do mecanismo, as facilidades de binding dos clientes, o protocolo de comunicação da camada de transporte e algumas medições de desempenho. Incluímos descrições de otimizações usadas para obter alto desempenho e reduzir a carga em servidores com muitos clientes.

## Visão geral

O artigo saiu na ACM Transactions on Computer Systems em fevereiro de 1984 (um relatório anterior do Xerox PARC, o CSL-83-7, é de dezembro de 1983). Ele vem do projeto Cedar, um ambiente de programação em estações Dorado de usuário único, escrito em Mesa e ligado por Ethernets de 3 Mbps dentro da rede de pesquisa da Xerox. Os autores notaram que construir programas que se comunicam era difícil e ficava com um grupo pequeno de especialistas. O objetivo era facilitar a computação distribuída, dando à comunicação "quase tanta facilidade quanto chamadas de procedimento locais", sem abrir mão de velocidade e segurança.

A ideia de RPC não era nova: o texto cita uma discussão de 1976 e a tese de doutorado de Nelson, e diz que implementações completas eram mais raras que projetos no papel. A contribuição aqui é um projeto completo e funcionando, e a pergunta mais difícil é o que uma chamada significa quando máquinas ou a rede falham. É o ancestral das camadas de RPC por trás de sistemas posteriores; compare com o modo como um grupo de consenso como o [Raft](/papers/raft-understandable-consensus-algorithm) é especificado por RPCs entre servidores. Vale saber antes: o que são um protocolo de transporte e uma confirmação (ack).

## Contribuição

- **Chamada de procedimento como abstração.** Foi escolhida porque chamadas de procedimento eram o principal mecanismo de transferência de controle e dados em Mesa. Os autores enunciam um princípio: a semântica da chamada remota deve ser o mais próxima possível da local. Por exemplo, não há timeout limitando uma chamada remota quando não ocorre falha.
- **Stubs e RPCRuntime.** Cinco peças participam de uma chamada: o usuário, o stub do usuário, o RPCRuntime, o stub do servidor e o servidor. Os stubs são gerados automaticamente por um programa chamado Lupine a partir de um módulo de interface Mesa. O RPCRuntime cuida de retransmissão, confirmações, roteamento de pacotes e criptografia.
- **Binding pelo Grapevine.** O nome de uma interface tem tipo e instância, e ambos são nomes do Grapevine. Assim o importador acha o exportador por um banco replicado, em vez de um endereço fixo no código.
- **Protocolo de transporte feito para RPC.** Em vez de fluxos de bytes, um protocolo em que o resultado confirma a chamada, a chamada seguinte confirma o resultado anterior e uma conexão ociosa custa uma entrada de tabela no servidor.
- **Semântica de chamada definida.** A garantia quando a chamada retorna e a garantia quando ela levanta uma exceção (veja Resultados).

## Metodologia

O artigo é um relato de projeto e experiência. Ele expõe as opções de cada decisão (troca de mensagens ou fork remoto contra chamada de procedimento, espaço de endereços compartilhado ou não, timeouts, momento do binding, protocolo de transporte) e diz qual foi escolhida e por quê. O binding é descrito passo a passo, com a sequência de export e import na Figura 2. O protocolo é descrito por figuras de uma chamada simples (Figura 3) e de uma chamada complicada (Figura 4).

O desempenho foi medido entre dois Dorados numa Ethernet de taxa bruta 2,94 megabits por segundo, compartilhada mas pouco carregada (de cinco a dez por cento da capacidade). Os tempos vieram da contagem de ciclos do microprocessador do Dorado, com precisão de cerca de dez por cento, em 12.000 chamadas por procedimento de teste, sem criptografia. Cada chamada é cronometrada desde o programa do usuário invocar o stub até o stub retornar.

## Resultados

**Semântica de chamada.** Se a chamada retorna, o procedimento do servidor foi invocado exatamente uma vez. Caso contrário, uma exceção é reportada e o procedimento rodou uma vez ou nenhuma, sem que o usuário saiba qual dos dois, nem se o servidor caiu ou a rede falhou. Enquanto o RPCRuntime do servidor continua respondendo às sondas não há limite de espera, então um servidor em deadlock ou em laço não é detectado. O artigo diz que isso é idêntico às chamadas locais.

**Protocolo.**
- Uma chamada simples usa dois pacotes: o resultado confirma a chamada e a chamada seguinte confirma o resultado. O identificador da chamada é formado por identificador da máquina, identificador do processo e número de sequência, e o servidor guarda o último número de sequência por atividade para descartar duplicatas.
- Não há estabelecimento nem encerramento de conexão. Uma conexão ociosa deixa uma entrada de tabela, que o servidor pode descartar após cerca de cinco minutos.
- Um chamador que espera uma chamada longa envia sondas, a primeira um pouco depois do tempo de ida e volta, e depois mais espaçadas até que, após cerca de 10 minutos, saia uma a cada cinco minutos.
- Chamadas cujos argumentos ou resultados ocupam vários pacotes confirmam cada pacote menos o último, de modo que só há um buffer em cada ponta, ao custo de até o dobro dos pacotes de um protocolo de transferência em massa.

**Medições (Tabela I, microssegundos: mínimo, mediana, transmissão, só local).**
- Sem argumentos nem resultados: 1059, 1097, 131, 9.
- Vetor de 100 palavras como argumento e resultado: 2915, 2926, 1219, 98.
- Exceção retomada pelo chamador: 2555, 2637, 284, 134. Exceção com unwind: 3374, 3467, 284, 196.
- Com chamadas paralelas de vários processos os autores chegaram a 2 megabits por segundo entre memórias principais de Dorados, igual à melhor implementação de fluxo de bytes deles, escrita em BCPL.
- O RPCRuntime tem quatro módulos Cedar, com cerca de 2.200 linhas. Entre os usuários estavam o servidor de arquivos Alpine, um projeto de telefone e áudio sobre Ethernet e dois jogos em rede.

## Análise crítica

O artigo é franco ao dizer que apresenta experiência inicial: afirma que precisa de uso "para valer" antes de julgar o projeto, e não mediu o custo de exportar ou importar uma interface.

- **Meta de desempenho.** O objetivo secundário era ficar dentro de um fator cinco do tempo de transmissão da rede. Pela minha conta a partir da Tabela I, a mediana da chamada nula é cerca de 8,4 vezes o tempo de transmissão, e a da chamada com vetor de 100 palavras cerca de 2,4 vezes; o artigo não afirma atingir a meta em todos os casos. A chamada nula custa cerca de 120 vezes a chamada local (1097 contra 9).
- **Modelo de falhas.** O artigo trata de quedas de máquina e de rompimentos de comunicação, e oferece uma única diferença visível em relação à chamada local, a exceção call failed. Não diz como o programa deve se recuperar de uma falha ambígua, por exemplo se deve tentar de novo, e nem usa a palavra idempotente. A passagem de argumentos sem espaço de endereços compartilhado e o gerador de stubs ficam para artigos futuros, assim como a segurança.
- **Especialização.** Contornar as camadas do protocolo é chamado de "trapaça" pelos próprios autores, pois só compensa porque RPC é o único caso especial.
- **Literatura posterior (fora deste artigo).** Waldo, Wyant, Wollrath e Kendall, "A Note on Distributed Computing" (relatório SMLI TR-94-29 da Sun Microsystems Laboratories, 1994; li uma reimpressão em capítulo de livro), argumentam que esconder a diferença entre chamada local e remota fracassa, e apontam falha parcial e concorrência como as diferenças que não dá para mascarar. Eles citam este artigo apenas numa lista de trabalhos de RPC dos anos 1980, e não como alvo da crítica. O próprio texto de Birrell e Nelson mantém a diferença visível, na exceção call failed e na garantia de "uma vez ou nenhuma".

## Pesquisas futuras

- Retentativa e idempotência: como as aplicações devem usar uma chamada que pode ou não ter rodado (o artigo deixa isso para o usuário).
- Passagem de argumentos, geração de stubs e segurança baseada em criptografia, que os autores anunciaram como artigos futuros.
- Se um protocolo de transporte de uso geral consegue o desempenho de RPC; os autores dizem estar indecisos.
- Casos em que RPC é o paradigma errado, que eles associam a soluções de multicast e broadcast.
- Rastreamento e diagnóstico de latência em muitas chamadas aninhadas em sistemas grandes, como no [Dapper](/papers/dapper-large-scale-distributed-systems-tracing-infrastructure).

---
title: "O serviço de locks Chubby para sistemas distribuídos fracamente acoplados"
summary: Burrows descreve o Chubby, o serviço de locks replicado do Google com interface de arquivos pequenos, feito para locks de granularidade grossa e eleição de primário, e explica como o uso real (sobretudo como serviço de nomes) obrigou a mudar o projeto original.
researchArea: Sistemas distribuídos
keywords: chubby, serviço de locks, eleição de líder, leases, sequenciadores, cache consistente, tolerância a falhas
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Descrevemos nossa experiência com o serviço de locks Chubby, que se destina a oferecer locks de granularidade grossa, além de armazenamento confiável (embora de baixo volume) para um sistema distribuído fracamente acoplado. O Chubby oferece uma interface muito parecida com a de um sistema de arquivos distribuído com locks consultivos, mas a ênfase do projeto está em disponibilidade e confiabilidade, e não em alto desempenho. Muitas instâncias do serviço foram usadas por mais de um ano, e várias delas atendem algumas dezenas de milhares de clientes ao mesmo tempo. O artigo descreve o projeto inicial e o uso esperado, compara-os com o uso real e explica como o projeto precisou ser modificado para acomodar as diferenças.

## Visão geral

Em 2006, os sistemas do Google precisavam de uma forma confiável de escolher um primário entre servidores equivalentes. O autor observa que isso é uma instância do problema de consenso distribuído, que redes assíncronas resolvem com Paxos ([Paxos simplificado](/papers/paxos-made-simple), [The Part-Time Parliament](/papers/paxos-part-time-parliament)): a segurança não exige suposições de tempo, e relógios entram para garantir vivacidade, o que contorna o resultado de impossibilidade do [FLP](/papers/flp-impossibility-of-distributed-consensus). O Chubby embrulha essa maquinaria num serviço que parece um pequeno sistema de arquivos com locks consultivos, e o Google File System e o Bigtable o usam para eleger seus mestres.

Antes do Chubby, a maioria dos sistemas do Google usava métodos ad hoc de eleição de primário quando trabalho duplicado era inofensivo, e precisava de intervenção do operador quando a correção era essencial. O artigo deixa claro que é um relato de engenharia: "não foi pesquisa", e ele não reivindica algoritmos ou técnicas novas. O valor está em explicar por que o serviço é como é e o que aconteceu quando desenvolvedores reais o usaram.

Vale conhecer antes: leases (uma promessa válida por tempo limitado), máquinas de estados replicadas como na [abordagem de máquina de estados](/papers/state-machine-approach-fault-tolerant-services-tutorial) e por que um processo que detém um lock ainda pode enviar uma requisição atrasada.

## Contribuição

- **Um serviço de locks em vez de uma biblioteca de consenso.** O artigo argumenta que um serviço de locks se encaixa melhor em programas existentes, atende a necessidade de divulgar nomes com arquivos pequenos, é familiar aos programadores e permite que o sistema cliente avance com segurança mesmo quando menos que a maioria dos seus próprios membros está de pé.
- **Locks de granularidade grossa por projeto.** Espera-se que os locks sejam mantidos por horas ou dias, como na eleição de um primário, o que mantém a carga baixa e deixa os locks sobreviverem ao fail-over de um servidor de locks. Quem precisa de locks de granularidade fina deve construí-los por cima.
- **Sequenciadores e lock-delay.** Quem detém um lock pode pedir um sequenciador, uma string opaca com o nome do lock, o modo e o número de geração do lock, e repassá-lo aos servidores com que conversa para que eles rejeitem requisições de um detentor obsoleto. Para servidores que não conseguem verificar sequenciadores, um lock-delay impede que o lock seja tomado por até um minuto depois que o detentor falha.
- **Sessões com período de graça.** As sessões dos clientes são leases mantidas por RPCs KeepAlive, com um período de graça padrão de 45 s que permite aos clientes atravessar fail-overs longos do mestre sem perder locks.
- **Cache consistente no cliente.** Invalidações enviadas pelo mestre dão aos clientes caches estritamente consistentes, o que se mostrou mais adequado a nomes do que TTLs ao estilo do DNS.

## Metodologia

É um artigo de experiência. Ele descreve a arquitetura (cinco réplicas por célula, um mestre eleito por consenso e sustentado por um master lease, uma biblioteca cliente e um proxy opcional), as interfaces de arquivos, handles, locks e eventos, o procedimento de fail-over e o banco de dados por baixo. Depois compara o uso esperado com o observado.

A evidência é operacional: um retrato de uma célula típica do Google (uma tabela de clientes, arquivos, locks e taxas de RPC), uma amostra de 61 interrupções em 700 células-dia, contagens de perda de dados ao longo de algumas dezenas de células-ano e histórias de erros de clientes. O artigo termina com uma comparação com o servidor de locks do Boxwood. Não há benchmark contra alternativas, e o artigo diz abertamente que omite o protocolo de consenso e os detalhes de RPC.

## Resultados

- **Locks são raros, os KeepAlives dominam.** Na célula do retrato havia 22 mil clientes conectados diretamente, 32 mil clientes via proxy e 12 mil arquivos abertos, com 1 mil locks exclusivos e nenhum compartilhado. Os KeepAlives eram 93% dos RPCs, e os acquires eram 31 partes por milhão.
- **A escala vem de falar menos com o mestre.** Um único mestre chegou a atender 90.000 clientes, não por um servidor mais rápido, mas por cache, extensão dos leases de 12 s (padrão) até cerca de 60 s sob carga e servidores de conversão de protocolo. O artigo diz que não houve esforço significativo para ajustar os caminhos de código do servidor.
- **O Chubby virou serviço de nomes.** O uso mais popular foi nomeação. O exemplo do artigo: um job de 3 mil clientes com TTL de DNS de 60 s precisaria de 150 mil consultas por segundo, contra cerca de 50 mil por segundo de um servidor DNS Xeon de 2 CPUs a 2,6 GHz. O cache por invalidação do Chubby elimina esse polling, e agrupar cerca de 100 nomes por consulta domou os picos de partida.
- **Números de disponibilidade.** Das 61 interrupções em 700 células-dia, a maioria durou 15 s ou menos e 52 ficaram abaixo de 30 s. As outras nove vieram de manutenção de rede (4), suspeita de problemas de rede (2), erros de software (2) e sobrecarga (1). Houve perda de dados seis vezes em algumas dezenas de células-ano (4 erros de software do banco, 2 erros de operador). Eleições observadas levaram 6 s e 4 s, com valores de até 30 s.
- **Latência.** Leituras no cliente levam menos de 1 ms numa célula local e 250 ms entre antípodas. Escritas, incluindo operações de lock, ganham de 5 a 10 ms a mais pela atualização do log do banco.
- **Erros de projeto.** Não havia cotas de armazenamento (um serviço reescrevia um único arquivo de 1,5 MB a cada ação do usuário, e foi criado um limite de 256 kB), os desenvolvedores raramente planejavam para indisponibilidade e alguns derrubavam a aplicação ao receber o evento de fail-over. KeepAlives sobre TCP perdiam sessões sob congestionamento, então passou-se a usar UDP.

### O que o artigo diz sobre locks e sequenciadores

Os locks são consultivos: segurar um lock nem é necessário para acessar o arquivo nem impede que outros o façam. O artigo declara o perigo central diretamente: quem detém o lock L pode emitir uma requisição R e depois falhar, outro processo pode adquirir L e agir, e R pode chegar depois e ser executada sem a proteção de L. Os remédios descritos são o sequenciador, verificado contra o cache do servidor no Chubby ou contra o sequenciador mais recente que o servidor já viu, e o lock-delay, mais barato mas "imperfeito". Na própria justificativa, o texto descreve uma versão da mesma ideia para servidores de arquivos existentes: passar o contador de aquisições junto com o RPC de escrita e rejeitar a escrita se o contador for menor que o valor atual.

## Análise crítica

- **Uma avaliação enxuta por projeto.** A evidência é um retrato, uma amostra de interrupções e anedotas. São críveis por virem de produção, mas não são reprodutíveis fora do Google, e a única comparação com outro sistema é uma discussão do servidor de locks do Boxwood.
- **A segurança dos locks depende dos clientes.** A proteção de um recurso externo depende de o servidor dele verificar o sequenciador. O artigo admite que "protocolos importantes evoluem devagar" e oferece o lock-delay como alternativa imperfeita, então a garantia para servidores não modificados é mais fraca do que para os que entendem sequenciadores. Ele também nota que programadores acham os locks familiares e "geralmente" os usam errado em ambientes distribuídos.
- **Suposições de relógio fazem parte do contrato.** A correção dos leases exige que o relógio do servidor não avance mais rápido que um fator constante conhecido em relação ao do cliente. O artigo declara essa exigência, mas não discute o que acontece se ela for violada.
- **O fail-over era o ponto fraco.** Os autores dizem que o código de fail-over, exercitado muito menos que o resto, "foi uma rica fonte de bugs interessantes", e a Seção 4.4 revisa o projeto depois que a otimização de registro de sessões se mostrou insegura num caso raro.
- **As alegações de escopo são modestas e honestas.** Os autores dizem que não precisaram do servidor de locks de granularidade fina que esboçaram e que os mecanismos de proxy e particionamento foram projetados, mas ainda não implantados. O leitor deve tratá-los como planos, não como resultados.

## Pesquisas futuras

- Serviços de coordenação baseados em consenso com o mesmo sabor de arquivos e locks, mas outras APIs (ZooKeeper e etcd são os descendentes mais conhecidos), e como o [Raft](/papers/raft-understandable-consensus-algorithm) tornou a camada de replicação mais fácil de implementar.
- Locking distribuído seguro em geral, incluindo quando um lock basta por eficiência e quando a correção exige fencing tokens verificados pelo recurso protegido, que é a ideia por trás dos sequenciadores do artigo.
- Otimizações de leitura baseadas em leases em sistemas de consenso, como o [Bodega](/papers/bodega-localized-linearizable-reads-with-roster-leases).
- Isolamento de clientes em serviços de coordenação compartilhados: cotas, revisão do uso pretendido e projetos que tornam chamadas repetidas baratas, como o artigo conclui para chamadas repetidas de Open().
- O banco replicado baseado em Paxos que substituiu o Berkeley DB e seu papel no projeto do fail-over, que o artigo apenas resume.

---
title: "Um sistema de arquivos rápido para UNIX"
summary: McKusick, Joy, Leffler e Fabry reimplementam o sistema de arquivos do UNIX para o VAX com blocos de 4096 ou 8192 bytes divididos em fragmentos, grupos de cilindros e alocação que considera a rotação do disco. Em um VAX 11/750 ele lê e escreve a até 47% da banda do disco, contra 3 a 5% do sistema antigo, e acrescenta nomes longos, travas consultivas, links simbólicos, rename e quotas.
researchArea: Sistemas operacionais
keywords: sistema de arquivos rápido, FFS, grupos de cilindros, fragmentos de bloco, layout em disco, política de alocação, layout rotacional, 4.2BSD
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

Descreve-se uma reimplementação do sistema de arquivos do UNIX. A reimplementação oferece taxas de transferência substancialmente maiores, com políticas de alocação mais flexíveis, que permitem melhor localidade de referência e podem ser adaptadas a uma ampla faixa de características de periféricos e processadores. O novo sistema agrupa os dados acessados sequencialmente e oferece dois tamanhos de bloco, para dar acesso rápido a arquivos grandes sem desperdiçar muito espaço com arquivos pequenos. Observam-se taxas de acesso até dez vezes maiores que as do sistema de arquivos UNIX tradicional. Discutem-se melhorias havia muito necessárias na interface dos programadores: um mecanismo de travas consultivas (advisory locks) em arquivos, a extensão do espaço de nomes entre sistemas de arquivos, o uso de nomes de arquivo longos e recursos para o controle administrativo do uso de recursos.

## Visão geral

Este é o sistema de arquivos do Berkeley distribuído com o 4.2BSD, depois chamado de FFS, publicado na ACM Transactions on Computer Systems em agosto de 1984 (volume 2, número 3, páginas 181-197). O texto que li é a cópia aberta de Berkeley, o relatório do Computer Systems Research Group revisado em 18 de fevereiro de 1984 (14 páginas), e não a diagramação do periódico, então a redação pode diferir um pouco da versão impressa. Ele parte do sistema de arquivos de [The UNIX Time-Sharing System](/papers/unix-time-sharing-system): super-bloco, inodes, blocos diretos e indiretos e uma lista livre encadeada, projetado para o PDP-11 com blocos de 512 bytes.

O problema é a vazão no VAX-11, onde aplicações como projeto de VLSI e processamento de imagens, e a paginação em grandes espaços de endereçamento virtual, precisam de largura de banda. O artigo diz que o sistema de 512 bytes dá cerca de dois por cento da banda máxima do disco, ou cerca de 20 kilobytes por segundo por braço. A interface é mantida e a implementação muda, então os usuários não enfrentam uma conversão massiva de software.

Os pareamentos com o catálogo são meus, não do artigo. [The Design and Implementation of a Log-Structured File System](/papers/log-structured-file-system) toma depois este projeto como base de comparação. [All File Systems Are Not Created Equal](/papers/all-file-systems-are-not-created-equal-crash-consistent-applications) e [Using Crash Hoare Logic for Certifying the FSCQ File System](/papers/using-crash-hoare-logic-for-certifying-the-fscq-file-system) estudam o comportamento diante de falhas que este artigo deixa de lado.

Vale conhecer antes: o que são um inode e um bloco indireto, o que são cilindro e trilha em um disco rotativo, e por que uma busca (seek) custa muito mais que uma transferência.

## Contribuição

- **Por que o sistema antigo era lento.** A primeira mudança de Berkeley, de 512 para 1024 bytes, mais que dobrou o desempenho, mas o sistema antigo ainda usava cerca de quatro por cento da banda. A lista livre começava ordenada e se embaralhava com a criação e a remoção de arquivos: 175 KB/s quando novo, 30 KB/s após algumas semanas de uso moderado. Os inodes ficavam longe dos dados (4 MB de inodes e 146 MB de dados em um sistema de 150 MB), então chegar a um arquivo exigia uma busca longa.
- **Blocos maiores com fragmentos.** Os blocos são qualquer potência de dois a partir de 4096, registrada no super-bloco. Um bloco pode ser dividido em 2, 4 ou 8 fragmentos endereçáveis, não menores que o setor do disco (tipicamente 512 bytes). Só o final de um arquivo usa fragmentos. O mínimo de 4096 é o que permite um arquivo de 2 elevado a 32 bytes com apenas dois níveis de indireção.
- **Grupos de cilindros.** A partição é dividida em grupos de cilindros consecutivos, cada um com uma cópia do super-bloco, seus inodes (por padrão um para cada 2048 bytes), um mapa de bits de blocos livres que substitui a lista livre e resumos de uso. As cópias são deslocadas cerca de uma trilha por grupo, de modo que perder um prato não elimina todas elas.
- **Política de posicionamento.** Os inodes dos arquivos de um diretório ficam no mesmo grupo. Um diretório novo vai para um grupo com mais inodes livres que a média e o menor número de diretórios. Os blocos de dados de um arquivo ficam no mesmo grupo, mas a alocação muda de grupo aos 48 KB e a cada megabyte seguinte, escolhendo um grupo com mais blocos livres que a média.
- **Alocação pela rotação.** Cada sistema de arquivos é parametrizado com as características do processador e do disco. O alocador salta blocos para que o próximo bloco do arquivo chegue sob a cabeça quando uma nova transferência puder começar. O alocador local tenta o bloco rotacionalmente mais próximo no cilindro, depois o grupo, depois um hash quadrático para outro grupo e, por fim, uma busca exaustiva. Uma reserva de espaço livre (10% nos testes) mantém as políticas funcionando.

## Metodologia

As medições vêm de um único sistema. Os programas de teste leem ou escrevem um arquivo sem processá-lo, com dados suficientes para anular o efeito do buffer, e rodam pelo menos três vezes. Os sistemas estavam em modo multiusuário, mas quietos, sem disputa por CPU nem pelo braço do disco. Todas as execuções usaram um VAX 11/750 e um disco AMPEX Capricorn de 330 megabytes, com controladora UNIBUS ou MASSBUS. Todos os sistemas de arquivos estavam em produção havia pelo menos um mês, com 10% de reserva de espaço livre. A largura de banda é a taxa obtida sobre um limite superior calculado como bytes por trilha vezes rotações por segundo (983 KB/s). O desperdício de espaço foi medido em um sistema de tempo compartilhado com cerca de 1,2 GB de armazenamento, sobre cerca de 920 MB de sistemas de arquivos de usuários ativos. Os testes são descritos em um relatório técnico de Berkeley que não li.

## Resultados

- **Acesso a inodes.** Listar um diretório grande de diretórios reduziu os acessos a disco para inodes por um fator de dois. Em diretórios grandes só com arquivos, a redução foi por um fator de oito.
- **Leituras (Tabela 2a).** Antigo 1024: 29 KB/s (3% da banda, 11% de CPU). Novo 4096/1024: 221 KB/s no UNIBUS (22%) e 466 no MASSBUS (47%). Novo 8192/1024: 233 no UNIBUS (24%) e 466 no MASSBUS (47%).
- **Escritas (Tabela 2b).** Antigo 1024: 48 KB/s (5%, 29% de CPU). Novo 4096/1024: 142 no UNIBUS (14%) e 323 no MASSBUS (33%, 94% de CPU). Novo 8192/1024: 215 no UNIBUS (22%) e 466 no MASSBUS (47%, 95% de CPU). Pela minha divisão, os melhores casos são cerca de 16 vezes mais rápidos na leitura e 9,7 vezes na escrita, enquanto o resumo diz até dez vezes.
- **Por quê.** O artigo atribui o ganho principalmente ao bloco maior. As escritas são mais lentas que as leituras no caso de 4096 porque o núcleo faz o dobro de alocações e o processador não acompanha. A cópia entre os buffers do núcleo e do usuário consome cerca de 40% do tempo de uma operação de E/S. As taxas novas não decaem com o tempo, mas caem para cerca da metade quando o sistema de arquivos está cheio.
- **Espaço (Tabela 1).** Nos dados medidos, os arquivos ocupam 775,2 MB sem separação, e o total com inodes é de 828,7 MB (6,9% de desperdício) com blocos de 512 bytes, 866,5 MB (11,8%) com 1024, 948,5 MB (22,4%) com 2048 e 1128,3 MB (45,6%) com 4096 sem fragmentos. Com fragmentos, o desperdício de 4096/1024 é próximo ao do sistema antigo de 1024, e o de 4096/512 ao do sistema de 512, somado à reserva.
- **Novas funcionalidades.** Nomes de arquivo de até 255 caracteres, em pedaços (chunks) de 512 bytes nos diretórios. Travas consultivas compartilhadas e exclusivas em arquivos abertos, com granularidade de arquivo inteiro e quase nenhuma detecção de deadlock. Links simbólicos entre sistemas de arquivos. Uma chamada rename que garante que o nome de destino exista, com verificação de laços em diretórios. Quotas de inodes e de blocos por usuário e por sistema de arquivos, com limites brando e rígido.

## Análise crítica

O que o próprio artigo não afirma, e que não encontrei nele:

- **Consistência após falha.** O fsck aparece só no histórico do sistema antigo (o programa de Kowalski, em uma referência), e o artigo não descreve procedimento de recuperação para o novo. A única proteção acrescentada é o super-bloco replicado. A chamada rename elimina uma janela de falha, e arquivos de trava deixam de sobrar após uma queda.
- **Portabilidade do ajuste.** O alocador depende da geometria do disco (blocos por trilha, velocidade de rotação, tempo de atendimento da interrupção) conhecida pelo sistema operacional. O cenário do artigo são discos de 1984 a 3600 rpm. Comentário meu: os discos de hoje escondem a geometria, então a parte rotacional não se transfere, enquanto as ideias de grupos e de agrupamento permanecem.
- **Uma máquina.** Todas as medições são em um VAX 11/750 e um modelo de disco, com um programa de teste por vez e vazão como métrica. Elas nada dizem sobre muitos processos concorrentes. O artigo lista o encadeamento de blocos e a pré-alocação como não implementados.
- **Custo de adoção.** Todos os sistemas de arquivos existentes tiveram de ser salvos e restaurados (dump e restore), e por isso as mudanças de interface vieram juntas.

Literatura posterior, separada do artigo e conferida só em parte. Ganger e Patt (OSDI 1994, só o resumo na página da USENIX) comparam esquemas de atualização de metadados e relatam que os soft updates superam as escritas síncronas por mais de um fator de dois em benchmarks pesados em metadados. McKusick e Ganger (USENIX 1999; li o resumo e a introdução) dizem que o FFS do BSD usava escritas síncronas para ordenar metadados e que os soft updates permitem rodá-lo sem fsck após uma queda, com uma tarefa em segundo plano recuperando blocos perdidos.

## Pesquisas futuras

- Recuperação após falha para um layout agrupado e com atualização no local, sem varredura completa.
- Alocação quando o sistema operacional não enxerga a geometria do disco, como em flash e em armazenamento virtualizado.
- Reduzir a cópia no núcleo (o artigo a estima em cerca de 40%) e o encadeamento de blocos nos drivers.
- Pré-alocação quando um arquivo cresce rápido, como no sistema de arquivos do DEMOS.
- Travas por intervalo de bytes (o artigo cita o sistema Onyx) e links simbólicos que atravessem máquinas, que ele descreve como possíveis em distribuições futuras.

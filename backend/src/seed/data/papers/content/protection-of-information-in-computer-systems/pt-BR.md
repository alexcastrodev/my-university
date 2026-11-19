---
title: "A proteção da informação em sistemas de computação"
summary: Saltzer e Schroeder escrevem o tutorial de 1975 que dá nome aos princípios clássicos de projeto de proteção (economia de mecanismo, padrões à prova de falha, mediação completa, projeto aberto e outros) e constrói descritores, capabilities e listas de controle de acesso a partir de um único modelo de muros, portas e guardas.
researchArea: Sistemas operacionais
keywords: proteção, princípios de projeto, privilégio mínimo, capabilities, listas de controle de acesso, descritores, subsistemas protegidos, multics
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Este artigo tutorial explora a mecânica de proteger informação armazenada em computador contra uso ou modificação não autorizados. Ele se concentra nas estruturas arquiteturais, de hardware ou de software, necessárias para sustentar a proteção da informação. O texto se desenvolve em três seções principais. A Seção I descreve funções desejadas, princípios de projeto e exemplos de mecanismos elementares de proteção e de autenticação. Qualquer leitor familiarizado com computadores deve achar a primeira seção razoavelmente acessível. A Seção II exige alguma familiaridade com arquitetura de computadores baseada em descritores. Ela examina em profundidade os princípios das arquiteturas modernas de proteção e a relação entre sistemas de capabilities e sistemas de listas de controle de acesso, e termina com uma breve análise de subsistemas protegidos e objetos protegidos. O leitor desanimado com os pré-requisitos ou com o nível de detalhe da segunda seção pode pular para a Seção III, que revisa o estado da arte e os projetos de pesquisa em andamento e oferece sugestões de leitura.

## Visão geral

Este é um tutorial por convite no Proceedings of the IEEE (volume 63, número 9, páginas 1278 a 1308, 1975), de Jerome Saltzer e Michael Schroeder, ambos do Project MAC e do departamento de EECS do MIT. O manuscrito foi recebido em outubro de 1974 e revisado em abril de 1975. A data importa para a leitura: o artigo olha para um mundo de máquinas de tempo compartilhado, terminais e linhas telefônicas, em que o IBM System/360 tinha apenas um estado privilegiado e uma chave de proteção de memória, e o "fetch protect" só virou padrão na arquitetura da IBM em 1970.

Os autores dizem com franqueza que não existe método completo para construir um sistema grande sem falhas de proteção, então oferecem princípios vindos da experiência e uma série de modelos de baixo para cima. O foco é o acesso direto por programas em execução (LOAD e STORE), não a privacidade, que o texto define como uma capacidade socialmente definida e deixa de lado.

Vale saber antes: o que são um segmento e um registrador de base e limite, e o que faz um supervisor. Os pareamentos abaixo são meus, o artigo de 1975 não pode citá-los. [O sistema de tempo compartilhado UNIX](/papers/unix-time-sharing-system) é um dos sistemas que o artigo lista entre os que tentam subsistemas protegidos especificados pelo usuário. O [Zanzibar](/papers/zanzibar-googles-consistent-global-authorization-system) é a lista de controle de acesso na escala do Google. O [Spectre](/papers/spectre-attacks-exploiting-speculative-execution) e o [Atmosphere](/papers/atmosphere-practical-verified-kernels-with-rust-and-verus) tocam dois temas que os autores levantam: hardware que se supunha isolar, e a certificação de um kernel de proteção. Para o concept do app sobre modelos de autorização de hoje, veja [Modelos de autorização](/identity-concepts/authorization-models-rbac-abac-rebac-and-policy-engines).

## Contribuição

- **Um vocabulário e um modelo.** Proteger é pôr um muro em volta de cada objeto, uma porta nele e um guarda na porta, que exige a correspondência entre algo que ele sabe e algo que o solicitante possui. Termos como principal, domínio, descritor, capability e lista de controle de acesso são definidos no glossário e usados o tempo todo.
- **Oito princípios de projeto, mais dois.** Economia de mecanismo, padrões à prova de falha (fail-safe defaults, atribuído a E. Glaser, 1965), mediação completa, projeto aberto, separação de privilégio (atribuída a R. Needham, 1973), privilégio mínimo, mecanismo comum mínimo e aceitabilidade psicológica. Outros dois, fator de trabalho (work factor) e registro de comprometimento (compromise recording), vêm da segurança física e "aplicam-se apenas de forma imperfeita a sistemas de computação". Os autores chamam os princípios de avisos, não de regras absolutas.
- **Níveis funcionais.** Sem proteção, tudo ou nada, compartilhamento controlado, controles de compartilhamento programados pelo usuário (subsistemas protegidos) e "pôr amarras na informação".
- **Duas famílias de mecanismo de compartilhamento.** Orientada a listas (o guarda tem uma lista) e orientada a bilhetes (o usuário tem bilhetes infalsificáveis), desenvolvidas como sistemas de listas de controle de acesso e sistemas de capabilities.
- **Autoridade para mudar autorizações.** Autocontrole e controle hierárquico, mais um campo de "prescript" para checagens contra abuso de autoridade, e a separação entre controles discricionários e não discricionários, com confinamento de programas emprestados.

## Metodologia

Não há experimentos. O método é uma sequência de modelos de baixo para cima, cada um corrigindo um defeito do anterior: uma máquina virtual isolada com registrador de descritor (base e limite) e bit de estado privilegiado; autenticação por senhas ou por handshake cifrado; descritores compartilhados com bits de permissão de leitura e escrita; segmentos com identificadores únicos, nunca reutilizados, e a separação entre endereçamento e proteção; um sistema de capabilities em memória com tags; controladores de acesso que guardam listas de controle de acesso; registradores de capability "sombra"; e subsistemas protegidos acessados por uma permissão ENTER. Os autores dizem que a escolha de baixo para cima difere do juízo de alguns colegas, e que os modelos servem para explicar conceitos, não sistemas específicos. A Seção III então revisa sistemas reais e pesquisas.

## Resultados

Todas as afirmações abaixo são do artigo.

- **Os princípios, como enunciados.** Economia de mecanismo: manter o projeto o mais simples e pequeno possível, já que caminhos de acesso indevidos não aparecem no uso normal. Padrões à prova de falha: basear decisões de acesso em permissão, não em exclusão. Mediação completa: todo acesso a todo objeto deve ser checado, e resultados de checagem lembrados precisam ser atualizados quando a autoridade muda. Projeto aberto: o projeto não deve ser secreto, só as chaves e senhas. Separação de privilégio: duas chaves são mais robustas que uma. Privilégio mínimo: o menor conjunto de privilégios para o trabalho. Mecanismo comum mínimo: minimizar o mecanismo compartilhado por todos os usuários, por exemplo uma rotina de biblioteca em vez de uma rotina do supervisor. Aceitabilidade psicológica: a interface humana deve ser fácil, para que os usuários apliquem a proteção corretamente.
- **Fator de trabalho.** O exemplo do artigo é a senha alfabética de quatro letras: 26 elevado a 4 dá 456.976 tentativas, uma barreira pequena para um atacante que teste um milhão de senhas por segundo. O texto nota que muitos mecanismos resistem a um cálculo direto de fator de trabalho.
- **Registro de comprometimento.** Só serve se o registro for à prova de adulteração, e é pouco usado em computadores porque um atacante esperto pode desfazer o dano lógico e os registros internos.
- **Capabilities.** Um bilhete infalsificável. Virtudes: eficiência (se quem acessa consegue apresentar uma, o pedido é válido), simplicidade e flexibilidade. Problemas: revogação, propagação e revisão de acesso. Mitigações discutidas: um bit de cópia, segmentos que guardam capabilities, um contador de profundidade (o CTSS usou uma versão em software, com limite de profundidade dois) e os objetos indiretos de Redell.
- **Listas de controle de acesso.** Consultadas a cada acesso, então a revogação é gerenciável e a pergunta "quem pode acessar este segmento" tem resposta direta. Custos: referências de memória em série, uma busca com possivelmente vários identificadores de principal e a alocação de listas de tamanho variável. Uma implementação popular permitia três entradas (criador, um grupo, todos os usuários).
- **Elas se combinam.** "A maioria dos sistemas reais usa uma combinação das duas formas, o sistema de capabilities pela velocidade e um sistema de listas de controle de acesso para a interface humana."
- **Multics.** Em 1969 o Multics implementou "um sistema completo de listas de controle de acesso baseado em descritores, com controle hierárquico da autorização" no Honeywell 645, e em 1973 os anéis de proteção com validação de endereço de argumentos chegaram ao hardware no Honeywell 6180. O artigo diz que o Multics usa listas de controle de acesso interpretadas por software com tabelas de descritores interpretadas por hardware.
- **Autenticação.** Em um estudo de cerca de 300 senhas escolhidas pelos próprios usuários, mais de 50 por cento podiam ser adivinhadas por exaustão ou derivavam do dono. O texto também descreve guardar senhas por uma transformação difícil de inverter e o ataque de mascaramento contra esquemas de mão única.
- **Problemas em aberto (Seção III).** Certificação de correção, invulnerabilidade a falhas únicas de hardware, restrições após a liberação da informação, cifragem e melhor autenticação. Um conjunto mínimo de kernel protegido "ainda não foi estabelecido".

## Análise crítica

O que o artigo não afirma: não dá evidência de que seguir os princípios evite falhas, não traz modelo formal nem prova, e não elege um vencedor entre capabilities e listas de controle de acesso. Não usa o termo "defesa em profundidade", trata de redes só de passagem (autenticação e cifragem) e deixa a proteção baseada em conteúdo (acesso estatístico) fora do tutorial. Ele avisa que o confinamento completo pode ser "muito difícil, ou talvez impossível" por causa de canais de sinalização como a taxa de paginação. E admite que os mecanismos de proteção são "desajeitados de programar" e mal casados com a imagem mental dos usuários, ponto que o texto trata como problema de pesquisa em aberto.

Uma observação pequena: o artigo conta quatro níveis funcionais no resumo, mas lista cinco itens (a a e), e depois se refere a um "quinto nível".

Literatura posterior (não faz parte deste artigo). Miller e Shapiro, "Paradigm Regained: Abstraction Mechanisms for Access Control" (ASIAN 2003, Springer LNCS 2896; conferido na cópia hospedada pelo MIT), citam o artigo para o privilégio mínimo, mas perguntam se ele deve ser lido como mínima permissão ou mínima autoridade, e argumentam que sistemas de capabilities foram "provados" incapazes de impor revogação, confinamento e as propriedades * porque a análise ignorava as abstrações de acesso. Eles também citam a passagem sobre controle discricionário mencionada acima.

## Pesquisas futuras

- Certificar um kernel de proteção contra um modelo preciso dos objetivos, o que o artigo diz ser muito mais difícil para compartilhamento controlado do que para isolamento. Veja o [Atmosphere](/papers/atmosphere-practical-verified-kernels-with-rust-and-verus) como uma tentativa moderna, em outro contexto.
- Fazer a especificação da proteção casar com o modo como as pessoas pensam (aceitabilidade psicológica), inclusive onde os usuários erram.
- Revogação, propagação e revisão de acesso em sistemas de capabilities, e como conviver com controles discricionários e não discricionários.
- Ler a história posterior: Miller e Shapiro (2003) para o argumento sobre capabilities, e o [Zanzibar](/papers/zanzibar-googles-consistent-global-authorization-system) para ver como ficam as listas de controle de acesso em escala.

---
version: 1.0
updatedAt: 2026-09-08
title: "Requisitos Funcionais vs. Não Funcionais"
summary: "Um requisito funcional enuncia um comportamento específico dado uma entrada específica, e é verificado exercitando-o e checando a saída; um requisito não funcional em vez disso restringe um atributo de qualidade (desempenho, confiabilidade, segurança, manutenibilidade) por entre muitas ocorrências ou sob condições realistas, verificado como uma distribuição medida; os dois falham de forma diferente em produção."
---
## Objetivos de Aprendizagem

- Definir um requisito funcional precisamente: uma declaração de um comportamento específico que o sistema tem de exibir dada uma entrada específica.
- Definir um requisito não funcional precisamente: uma restrição sobre a qualidade, o desempenho ou a condição sob a qual o comportamento funcional tem de se manter, não um comportamento em si.
- Explicar por que um requisito funcional perdido e um requisito não funcional perdido falham de forma diferente na prática, e por que o segundo é sistematicamente mais perigoso.
- Classificar uma leva de declarações de requisito reais e concretas corretamente, incluindo pelo menos uma declaração que parece funcional mas é de fato um requisito não funcional disfarçado.

## Contexto e Motivação

`requirements-elicitation-specification-and-validation` estabeleceu que uma especificação tem de ser precisa o bastante para dois engenheiros construírem a mesma coisa a partir dela. Este conceito afia essa precisão um nível além nomeando uma distinção que toda especificação real tem de acertar: se um dado requisito enuncia *o que* o sistema faz, ou *quão bem* (ou sob qual restrição) ele tem de fazê-lo. O livro-texto de Sommerville traça esta linha como a distinção funcional versus não funcional, e ela não é um exercício de classificação pedante. Os dois tipos de requisito são verificados de forma diferente, falham de forma diferente em produção, e, como `from-requirements-to-architecture-decisions` mostra depois nesta disciplina, dirigem decisões a jusante genuinamente diferentes: um requisito funcional majoritariamente restringe que código é escrito, enquanto um requisito não funcional frequentemente restringe qual arquitetura é sequer viável em primeiro lugar.

## Teoria Central

### Requisitos funcionais: comportamento específico, entrada específica

Um requisito funcional enuncia um comportamento discreto e checável: "dado um username e senha válidos, o sistema tem de autenticar o usuário e emitir um token de sessão". Ele é verificado exercitando o sistema com uma entrada específica e checando uma saída ou efeito específico, exatamente o tipo de declaração que `unit-integration-and-system-testing` (`software-construction`) já ensina como testar em todo nível do unitário ao de sistema. Um requisito funcional que está faltando ou errado produz um defeito claro e reportável: um usuário tenta fazer login, o comportamento específico não acontece, alguém registra um bug.

### Requisitos não funcionais: atributos de qualidade e restrições

Um requisito não funcional restringe um atributo de qualidade do sistema como um todo, ou de algum comportamento funcional, em vez de enunciar um novo comportamento próprio: "o endpoint de autenticação tem de responder dentro de 300 milissegundos para 99% das requisições", "o sistema tem de permanecer disponível durante uma indisponibilidade de data center único", "o código tem de permitir que um novo provedor de pagamento seja adicionado sem modificar o código de provedor existente". Nenhuma destas três frases descreve uma coisa nova que o sistema faz; cada uma restringe quão bem, quão confiavelmente ou quão flexivelmente um comportamento existente ou planejado tem de se sustentar.

```text
FUNCIONAL:      "O sistema autentica um usuário com um username
                 e senha válidos."
                 -> verificado por: exercitar com entrada específica,
                    checar saída específica.

NÃO FUNCIONAL:  "O endpoint de autenticação responde dentro de
                 300ms para 99% das requisições."
                 -> verificado por: teste de carga, medindo uma
                    distribuição por entre muitas requisições, não um
                    único check passa/falha em uma entrada.
```

### Por que os dois falham de forma diferente em produção

Um requisito funcional faltante produz um defeito visível no momento em que alguém exercita o comportamento faltante; ele é barulhento, específico e fácil de atribuir a uma causa. Um requisito não funcional faltante ou subespecificado é sistematicamente mais quieto e mais perigoso: um sistema com todo requisito funcional corretamente implementado ainda pode ser inteiramente inutilizável sob carga real, inteiramente inseguro contra um atacante real, ou inteiramente não manutenível depois de seis meses de trabalho de recurso, e nenhuma dessas falhas aparece como um único caso de teste falhando da forma que um bug funcional aparece. É exatamente por isso que `scalability-and-maintainability-principles` (`system-design-concepts`) enquadra escalabilidade e manutenibilidade como parâmetros de carga e uma tríade de operabilidade-simplicidade-evolutibilidade em vez de como checks de passa/falha: a qualidade não funcional é medida num espectro sob condições realistas, não verificada com uma única entrada.

### Uma categoria não funcional comum: as características de qualidade da ISO 25010, nomeadas honestamente

Requisitos não funcionais reais se agrupam em categorias bem conhecidas: desempenho (latência, throughput), confiabilidade (disponibilidade, tolerância a falhas), segurança, usabilidade, manutenibilidade e portabilidade, entre outras. Este conceito não alega que estas categorias são exaustivas ou perfeitamente separáveis (um requisito de segurança e um requisito de confiabilidade frequentemente interagem diretamente, como `from-requirements-to-architecture-decisions` mostrará), só que nomear a categoria na qual um dado requisito cai é um passo genuinamente útil em direção a escrevê-lo precisamente o bastante para verificar.

## Exemplos Resolvidos

### Exemplo 1: classificando uma leva de requisitos

```text
1. "Usuários podem redefinir a sua senha via um link enviado por email."  -> Funcional
2. "Emails de redefinição de senha têm de ser entregues dentro de 60
    segundos da requisição, 95% das vezes."                   -> Não funcional (desempenho)
3. "O sistema tem de suportar pelo menos 50.000 sessões
    ativas concorrentes."                                     -> Não funcional (escalabilidade)
4. "Um usuário bloqueado consegue desbloquear a sua conta depois de
    três tentativas falhas contatando o suporte."              -> Funcional
5. "Todas as senhas armazenadas têm de ter hash, nunca armazenadas
    em texto simples."                                          -> Não funcional (segurança)
```

A declaração 1 e a declaração 2 parecem similares (ambas são sobre redefinição de senha) mas classificam diferentemente: 1 enuncia um comportamento específico que o sistema realiza; 2 restringe quão rápido esse comportamento tem de ocorrer por entre muitas ocorrências, não o que o comportamento é.

### Exemplo 2: um requisito funcional disfarçado de instrução de design

"O sistema tem de usar uma fila de mensagens para processar pedidos." Lido literalmente isto soa como uma decisão de arquitetura, não um requisito de todo, e é um erro de especificação comum e real: ele contrabandeia uma escolha de implementação específica (uma fila de mensagens) como se fosse uma necessidade de stakeholder. O requisito subjacente de fato é quase sempre não funcional: talvez "o processamento de pedidos tem de continuar aceitando novos pedidos mesmo se o provedor de pagamento estiver temporariamente indisponível" (um requisito de confiabilidade), que uma fila de mensagens por acaso é uma forma razoável de satisfazer, mas não é em si o requisito. Escrever a escolha de implementação no requisito antecipa e elimina o trabalho de `from-requirements-to-architecture-decisions` antes de ele começar, e uma revisão de validação (`requirements-elicitation-specification-and-validation`) deveria pegar e reescrever declarações como esta de volta à necessidade subjacente real.

### Exemplo 3: dois sistemas que passam por todo teste funcional e ainda falham

Uma equipe envia um recurso de busca. Todo teste funcional passa: buscar um título exato retorna o resultado certo, buscar uma correspondência parcial retorna um conjunto de resultados razoável, buscar sem resultados mostra o estado vazio correto. Três semanas depois do lançamento, o tráfego real revela que o endpoint de busca leva 4 segundos para responder sob carga normal, porque nenhum requisito não funcional foi jamais escrito para a latência da busca, e nenhum teste de carga jamais a exercitou. Os requisitos funcionais estavam corretos e completamente implementados; o requisito não funcional faltante produziu uma falha de produção real invisível a todo teste que a equipe de fato rodou.

## Equívocos Comuns e Armadilhas

- **"Requisitos não funcionais são opcionais ou 'bons de ter'."** O Exemplo 3 mostra que uma implementação funcional totalmente correta ainda pode ser um produto inutilizável e falho se um requisito não funcional (latência, nesse caso) nunca foi escrito e verificado; requisitos não funcionais não são um complemento de menor prioridade aos funcionais.
- **"Uma decisão de arquitetura escrita num requisito é só ser específico."** O Exemplo 2 mostra que isto especificamente antecipa e elimina a decisão a jusante de fato (`from-requirements-to-architecture-decisions`) e geralmente esconde a necessidade não funcional real e verificável sob uma escolha de implementação prematura.
- **"Você consegue verificar um requisito não funcional da mesma forma que verifica um funcional, só cheque uma vez."** A distinção na Teoria Central é explícita: um requisito não funcional é verificado como uma distribuição sob condições realistas (uma porcentagem de requisições dentro de um limite de latência, disponibilidade por uma janela de tempo real), não como um único passa ou falha em uma entrada, que é exatamente por que o teste não funcional (teste de carga, teste de caos) é uma atividade genuinamente diferente do teste funcional.

## Resumo

Um requisito funcional enuncia um comportamento específico dado uma entrada específica, e é verificado da mesma forma que `unit-integration-and-system-testing` já ensina: exercite-o, cheque a saída. Um requisito não funcional em vez disso restringe um atributo de qualidade (desempenho, confiabilidade, segurança, manutenibilidade) por entre muitas ocorrências ou sob condições realistas, e é verificado como uma distribuição medida, não um único check de passa ou falha em uma entrada. Os dois falham de forma diferente em produção: um requisito funcional faltante produz um bug barulhento, específico e facilmente atribuído, enquanto um requisito não funcional faltante pode deixar um sistema que passa por todo teste funcional ainda fundamentalmente inutilizável uma vez que carga real, atacantes reais ou pressão de manutenção real chegam. Escrever uma escolha de implementação diretamente numa declaração de requisito, em vez da necessidade não funcional subjacente que ela é feita para satisfazer, é um erro real comum que antecipa e elimina a decisão de arquitetura genuína que esta disciplina trata separadamente em `from-requirements-to-architecture-decisions`.

## Documentation Links

- [Sommerville: Software Engineering (10th Edition, Pearson)](https://www.pearson.com/en-us/subject-catalog/p/software-engineering/P200000003258/9780137503148): a fonte de livro-texto padrão para a distinção funcional versus não funcional e as categorias não funcionais comuns usadas nos exemplos de classificação deste conceito.
- [IEEE Computer Society: SWEBOK v4.0 Guide](https://www.computer.org/education/bodies-of-knowledge/software-engineering): a área de conhecimento de Requisitos de Software à qual esta classificação pertence, ao lado de elicitação, especificação e validação.
